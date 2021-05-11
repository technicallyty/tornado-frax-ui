// const fs = require("fs");
const axios = require("axios");
const assert = require("assert");
const snarkjs = require("snarkjs");
const crypto = require("crypto");
const circomlib = require("circomlib");
const bigInt = snarkjs.bigInt;
const merkleTree = require("./lib/MerkleTree");
const Web3 = require("web3");
const buildGroth16 = require("websnark/src/groth16");
const websnarkUtils = require("websnark/src/utils");
const { toWei, fromWei, toBN, BN } = require("web3-utils");
const pkey = require('./build/circuits/tornadoProvingKey.bin');

const ETHTornadoJSON = require("./build/contracts/ETHTornado.json");
const withdrawCircuit = require("./build/circuits/withdraw.json");
const MOCKERC20 = require("./build/contracts/ERC20Mock.json")

let web3, tornado, circuit, proving_key, groth16, erc20, senderAccount, netId;
let MERKLE_TREE_HEIGHT;



/** Generate random number of specified byte length */
const rbigint = (nbytes) =>
  snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes));

/** Compute pedersen hash */
const pedersenHash = (data) =>
  circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0];

/** BigNumber to hex string of specified length */
function toHex(number, length = 32) {
  const str =
    number instanceof Buffer
      ? number.toString("hex")
      : bigInt(number).toString(16);
  return "0x" + str.padStart(length * 2, "0");
}

/** Display ETH account balance */
// async function printETHBalance({ address, name }) {
//   console.log(
//     `${name} ETH balance is`,
//     web3.utils.fromWei(await web3.eth.getBalance(address))
//   );
// }

// /** Display ERC20 account balance */
// async function printERC20Balance({ address, name, tokenAddress }) {
//   const erc20ContractJson = require("./build/contracts/ERC20Mock.json");
//   erc20 = tokenAddress
//     ? new web3.eth.Contract(erc20ContractJson.abi, tokenAddress)
//     : erc20;
//   console.log(
//     `${name} Token Balance is`,
//     web3.utils.fromWei(await erc20.methods.balanceOf(address).call())
//   );
// }

/**
 * Create deposit object from secret and nullifier
 */
function createDeposit({ nullifier, secret }) {
  const deposit = { nullifier, secret };
  deposit.preimage = Buffer.concat([
    deposit.nullifier.leInt2Buff(31),
    deposit.secret.leInt2Buff(31),
  ]);
  deposit.commitment = pedersenHash(deposit.preimage);
  deposit.commitmentHex = toHex(deposit.commitment);
  deposit.nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31));
  deposit.nullifierHex = toHex(deposit.nullifierHash);
  return deposit;
}

/**
 * Make a deposit
 * @param currency Сurrency
 * @param amount Deposit amount
 */
async function deposit({ currency, amount }) {
  const deposit = createDeposit({
    nullifier: rbigint(31),
    secret: rbigint(31),
  });
  const note = toHex(deposit.preimage, 62);
  const noteString = `tornado-${currency}-${amount}-${netId}-${note}`;
  console.log(`Your note: ${noteString}`);
    // a token
    //await printERC20Balance({ address: tornado._address, name: "Tornado" });
    // await printERC20Balance({ address: senderAccount, name: "Sender account" });
    const decimals = 18
    const tokenAmount = fromDecimals({ amount, decimals });
    const allowance = await erc20.methods
      .allowance(senderAccount, tornado._address)
      .call({ from: senderAccount });
    console.log("Current allowance is", fromWei(allowance));
    if (toBN(allowance).lt(toBN(tokenAmount))) {
      console.log("Approving tokens for deposit");
      await erc20.methods
        .approve(tornado._address, tokenAmount)
        .send({ from: senderAccount, gas: 1e6 });
    }

    console.log("Submitting deposit transaction");
    await tornado.methods
      .deposit(toHex(deposit.commitment))
      .send({ from: senderAccount, gas: 2e6 });
    //await printERC20Balance({ address: tornado._address, name: "Tornado" });
    //await printERC20Balance({ address: senderAccount, name: "Sender account" });
  
  alert("Deposit Successful.");
  return noteString;
}

/**
 * Generate merkle tree for a deposit.
 * Download deposit events from the tornado, reconstructs merkle tree, finds our deposit leaf
 * in it and generates merkle proof
 * @param deposit Deposit object
 */
async function generateMerkleProof(deposit) {
  // Get all deposit events from smart contract and assemble merkle tree from them
  console.log("Getting current state from tornado contract");
  const events = await tornado.getPastEvents("Deposit", {
    fromBlock: 0,
    toBlock: "latest",
  });
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
    .map((e) => e.returnValues.commitment);
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves);

  // Find current commitment in the tree
  const depositEvent = events.find(
    (e) => e.returnValues.commitment === toHex(deposit.commitment)
  );
  const leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1;

  // Validate that our data is correct
  const root = await tree.root();
  const isValidRoot = await tornado.methods.isKnownRoot(toHex(root)).call();
  const isSpent = await tornado.methods
    .isSpent(toHex(deposit.nullifierHash))
    .call();
  assert(isValidRoot === true, "Merkle tree is corrupted");
  assert(isSpent === false, "The note is already spent");
  assert(leafIndex >= 0, "The deposit is not found in the tree");

  // Compute merkle proof of our commitment
  return tree.path(leafIndex);
}

/**
 * Generate SNARK proof for withdrawal
 * @param deposit Deposit object
 * @param recipient Funds recipient
 * @param relayer Relayer address
 * @param fee Relayer fee
 * @param refund Receive ether for exchanged tokens
 */
async function generateProof({
  deposit,
  recipient,
  relayerAddress = 0,
  fee = 0,
  refund = 0,
}) {
  // Compute merkle proof of our commitment
  const { root, path_elements, path_index } = await generateMerkleProof(
    deposit
  );

  // Prepare circuit input
  const input = {
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHash,
    recipient: bigInt(recipient),
    relayer: bigInt(relayerAddress),
    fee: bigInt(fee),
    refund: bigInt(refund),

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndices: path_index,
  };

  console.log("Generating SNARK proof");
  console.time("Proof time");
  console.log(proving_key);
  const proofData = await websnarkUtils.genWitnessAndProve(
    groth16,
    input,
    circuit,
    proving_key
  );
  const { proof } = websnarkUtils.toSolidityInput(proofData);
  console.timeEnd("Proof time");

  const args = [
    toHex(input.root),
    toHex(input.nullifierHash),
    toHex(input.recipient, 20),
    toHex(input.relayer, 20),
    toHex(input.fee),
    toHex(input.refund),
  ];

  return { proof, args };
}

/**
 * Do an ETH withdrawal
 * @param noteString Note to withdraw
 * @param recipient Recipient address
 */
async function withdraw({
  deposit,
  currency,
  amount,
  recipient,
  relayerURL,
  refund = "0",
}) {
  if (currency === "eth" && refund !== "0") {
    throw new Error(
      "The ETH purchase is supposted to be 0 for ETH withdrawals"
    );
  }
  refund = toWei(refund);
  if (relayerURL) {
    if (relayerURL.endsWith(".eth")) {
      throw new Error(
        "ENS name resolving is not supported. Please provide DNS name of the relayer. See instuctions in README.md"
      );
    }
    const relayerStatus = await axios.get(relayerURL + "/status");
    const {
      relayerAddress,
      netId,
      gasPrices,
      ethPrices,
      relayerServiceFee,
    } = relayerStatus.data;
    assert(
      netId === (await web3.eth.net.getId()) || netId === "*",
      "This relay is for different network"
    );
    console.log("Relay address: ", relayerAddress);

    const decimals = 18
    const fee = calculateFee({
      gasPrices,
      currency,
      amount,
      refund,
      ethPrices,
      relayerServiceFee,
      decimals,
    });
    if (fee.gt(fromDecimals({ amount, decimals }))) {
      throw new Error("Too high refund");
    }
    const { proof, args } = await generateProof({
      deposit,
      recipient,
      relayerAddress,
      fee,
      refund,
    });

    console.log("Sending withdraw transaction through relay");
    try {
      const relay = await axios.post(relayerURL + "/relay", {
        contract: tornado._address,
        proof,
        args,
      });
      if (netId === 1 || netId === 42) {
        console.log(
          `Transaction submitted through the relay. View transaction on etherscan https://${getCurrentNetworkName()}etherscan.io/tx/${
            relay.data.txHash
          }`
        );
      } else {
        console.log(
          `Transaction submitted through the relay. The transaction hash is ${relay.data.txHash}`
        );
      }

      const receipt = await waitForTxReceipt({ txHash: relay.data.txHash });
      console.log("Transaction mined in block", receipt.blockNumber);
    } catch (e) {
      if (e.response) {
        console.error(e.response.data.error);
      } else {
        console.error(e.message);
      }
    }
  } else {
    // using private key
    const { proof, args } = await generateProof({ deposit, recipient, refund });

    console.log("Submitting withdraw transaction");
    await tornado.methods
      .withdraw(proof, ...args)
      .send({ from: senderAccount, value: refund.toString(), gas: 1e6 })
      .on("transactionHash", function (txHash) {
        if (netId === 1 || netId === 42) {
          console.log(
            `View transaction on etherscan https://${getCurrentNetworkName()}etherscan.io/tx/${txHash}`
          );
        } else {
          console.log(`The transaction hash is ${txHash}`);
        }
      })
      .on("error", function (e) {
        console.error("on transactionHash error", e.message);
      });
  }
  console.log("Done");
}

function fromDecimals({ amount, decimals }) {
  amount = amount.toString();
  let ether = amount.toString();
  const base = new BN("10").pow(new BN(decimals));
  const baseLength = base.toString(10).length - 1 || 1;

  const negative = ether.substring(0, 1) === "-";
  if (negative) {
    ether = ether.substring(1);
  }

  if (ether === ".") {
    throw new Error(
      "[ethjs-unit] while converting number " +
        amount +
        " to wei, invalid value"
    );
  }

  // Split it into a whole and fractional part
  const comps = ether.split(".");
  if (comps.length > 2) {
    throw new Error(
      "[ethjs-unit] while converting number " +
        amount +
        " to wei,  too many decimal points"
    );
  }

  let whole = comps[0];
  let fraction = comps[1];

  if (!whole) {
    whole = "0";
  }
  if (!fraction) {
    fraction = "0";
  }
  if (fraction.length > baseLength) {
    throw new Error(
      "[ethjs-unit] while converting number " +
        amount +
        " to wei, too many decimal places"
    );
  }

  while (fraction.length < baseLength) {
    fraction += "0";
  }

  whole = new BN(whole);
  fraction = new BN(fraction);
  let wei = whole.mul(base).add(fraction);

  if (negative) {
    wei = wei.mul(negative);
  }

  return new BN(wei.toString(10), 10);
}

// function toDecimals(value, decimals, fixed) {
//   const zero = new BN(0);
//   const negative1 = new BN(-1);
//   decimals = decimals || 18;
//   fixed = fixed || 7;

//   value = new BN(value);
//   const negative = value.lt(zero);
//   const base = new BN("10").pow(new BN(decimals));
//   const baseLength = base.toString(10).length - 1 || 1;

//   if (negative) {
//     value = value.mul(negative1);
//   }

//   let fraction = value.mod(base).toString(10);
//   while (fraction.length < baseLength) {
//     fraction = `0${fraction}`;
//   }
//   fraction = fraction.match(/^([0-9]*[1-9]|0)(0*)/)[1];

//   const whole = value.div(base).toString(10);
//   value = `${whole}${fraction === "0" ? "" : `.${fraction}`}`;

//   if (negative) {
//     value = `-${value}`;
//   }

//   if (fixed) {
//     value = value.slice(0, fixed);
//   }

//   return value;
// }

function getCurrentNetworkName() {
  switch (netId) {
    case 1:
      return "";
    case 42:
      return "kovan.";
    default:
      return "arbitrum";
  }
}

function calculateFee({
  gasPrices,
  currency,
  amount,
  refund,
  ethPrices,
  relayerServiceFee,
  decimals,
}) {
  const decimalsPoint =
    Math.floor(relayerServiceFee) === Number(relayerServiceFee)
      ? 0
      : relayerServiceFee.toString().split(".")[1].length;
  const roundDecimal = 10 ** decimalsPoint;
  const total = toBN(fromDecimals({ amount, decimals }));
  const feePercent = total
    .mul(toBN(relayerServiceFee * roundDecimal))
    .div(toBN(roundDecimal * 100));
  const expense = toBN(toWei(gasPrices.fast.toString(), "gwei")).mul(toBN(5e5));
  let desiredFee;
  switch (currency) {
    case "eth": {
      desiredFee = expense.add(feePercent);
      break;
    }
    default: {
      desiredFee = expense
        .add(toBN(refund))
        .mul(toBN(10 ** decimals))
        .div(toBN(ethPrices[currency]));
      desiredFee = desiredFee.add(feePercent);
      break;
    }
  }
  return desiredFee;
}

/**
 * Waits for transaction to be mined
 * @param txHash Hash of transaction
 * @param attempts
 * @param delay
 */
function waitForTxReceipt({ txHash, attempts = 60, delay = 1000 }) {
  return new Promise((resolve, reject) => {
    const checkForTx = async (txHash, retryAttempt = 0) => {
      const result = await web3.eth.getTransactionReceipt(txHash);
      if (!result || !result.blockNumber) {
        if (retryAttempt <= attempts) {
          setTimeout(() => checkForTx(txHash, retryAttempt + 1), delay);
        } else {
          reject(new Error("tx was not mined"));
        }
      } else {
        resolve(result);
      }
    };
    checkForTx(txHash);
  });
}

/**
 * Parses Tornado.cash note
 * @param noteString the note
 */
function parseNote(noteString) {
  const noteRegex = /tornado-(?<currency>\w+)-(?<amount>[\d.]+)-(?<netId>\d+)-0x(?<note>[0-9a-fA-F]{124})/g;
  const match = noteRegex.exec(noteString);
  if (!match) {
    throw new Error("The note has invalid format");
  }

  const buf = Buffer.from(match.groups.note, "hex");
  const nullifier = bigInt.leBuff2int(buf.slice(0, 31));
  const secret = bigInt.leBuff2int(buf.slice(31, 62));
  const deposit = createDeposit({ nullifier, secret });
  const netId = Number(match.groups.netId);

  return {
    currency: match.groups.currency,
    amount: match.groups.amount,
    netId,
    deposit,
  };
}

// async function loadDepositData({ deposit }) {
//   try {
//     const eventWhenHappened = await tornado.getPastEvents("Deposit", {
//       filter: {
//         commitment: deposit.commitmentHex,
//       },
//       fromBlock: 0,
//       toBlock: "latest",
//     });
//     if (eventWhenHappened.length === 0) {
//       throw new Error("There is no related deposit, the note is invalid");
//     }

//     const { timestamp } = eventWhenHappened[0].returnValues;
//     const txHash = eventWhenHappened[0].transactionHash;
//     const isSpent = await tornado.methods.isSpent(deposit.nullifierHex).call();
//     const receipt = await web3.eth.getTransactionReceipt(txHash);

//     return {
//       timestamp,
//       txHash,
//       isSpent,
//       from: receipt.from,
//       commitment: deposit.commitmentHex,
//     };
//   } catch (e) {
//     console.error("loadDepositData", e);
//   }
//   return {};
// }

// async function loadWithdrawalData({ amount, currency, deposit }) {
//   try {
//     const events = await await tornado.getPastEvents("Withdrawal", {
//       fromBlock: 0,
//       toBlock: "latest",
//     });

//     const withdrawEvent = events.filter((event) => {
//       return event.returnValues.nullifierHash === deposit.nullifierHex;
//     })[0];

//     const fee = withdrawEvent.returnValues.fee;
//     const decimals = config.deployments[`netId${netId}`][currency].decimals;
//     const withdrawalAmount = toBN(fromDecimals({ amount, decimals })).sub(
//       toBN(fee)
//     );
//     const { timestamp } = await web3.eth.getBlock(withdrawEvent.blockHash);
//     return {
//       amount: toDecimals(withdrawalAmount, decimals, 9),
//       txHash: withdrawEvent.transactionHash,
//       to: withdrawEvent.returnValues.to,
//       timestamp,
//       nullifier: deposit.nullifierHex,
//       fee: toDecimals(fee, decimals, 9),
//     };
//   } catch (e) {
//     console.error("loadWithdrawalData", e);
//   }
// }

/**
 * Init web3, contracts, and snark
 */
async function init(noteNetId, instance, web3) {
  let tornadoAddress = "0xBfa9987c7b7eBD56fFBd04c2CdDA3d6a30BD668B";
  let tokenAddress = "0x2802397f5073CB9067FDcF974d9164F9E3EA29f8";
  let contractJson = ETHTornadoJSON;
  // circuit = await (await fetch("build/circuits/withdraw.json")).json();
  circuit = withdrawCircuit;
  //proving_key = await (await fetch('build/circuits/tornadoProvingKey.bin')).arrayBuffer();
  proving_key = await fetch('build/circuits/tornadoProvingKey.bin')
  console.log(proving_key);
  MERKLE_TREE_HEIGHT = 20;
  senderAccount = (await web3.eth.getAccounts())[0];
  // groth16 initialises a lot of Promises that will never be resolved, that's why we need to use process.exit to terminate the CLI
  groth16 = await buildGroth16();
  netId = await web3.eth.net.getId();
  if (noteNetId && Number(noteNetId) !== netId) {
    throw new Error(
      "This note is for a different network. Specify the --rpc option explicitly"
    );
  }

  // NOT NEEDED NO LOCAL RPC
  // if (isLocalRPC) {
  //   tornadoAddress =
  //     currency === "eth"
  //       ? contractJson.networks[netId].address
  //       : erc20tornadoJson.networks[netId].address;
  //   tokenAddress =
  //     currency !== "eth" ? erc20ContractJson.networks[netId].address : null;
  //   senderAccount = (await web3.eth.getAccounts())[0];
  // } else {
  //   try {
  //     tornadoAddress =
  //       config.deployments[`netId${netId}`][currency].instanceAddress[amount];
  //     if (!tornadoAddress) {
  //       throw new Error();
  //     }
  //     tokenAddress = config.deployments[`netId${netId}`][currency].tokenAddress;
  //   } catch (e) {
  //     console.error(
  //       "There is no such tornado instance, check the currency and amount you provide"
  //     );
  //     process.exit(1);
  //   }
  // }
  // END NOT NEEDED

  // TODO get tornado address
  // TODO get token address
  tornado = new web3.eth.Contract(contractJson.abi, tornadoAddress);
  erc20 = new web3.eth.Contract(MOCKERC20.abi, tokenAddress);
}

async function twister(web3, instance) {
  await init(212984383488152,instance, web3);
  await deposit(instance);
  
}

async function getMyMoneyPls(note, web3, provingKey) {
  console.log("LETS GET THAT MONEY")
    const noteString = note
    const recipient = (await web3.eth.getAccounts())[0];

    const { currency, amount, netId, deposit } = parseNote(noteString);
    let instance = {
      currency: currency,
      amount: amount
    }
    await init(netId, instance, web3);
    proving_key = provingKey;
    await withdraw({ deposit, currency, amount, recipient });
}

exports.twister = twister;
exports.withdrawal = getMyMoneyPls;
