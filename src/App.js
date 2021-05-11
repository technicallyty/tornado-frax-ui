import './App.css';
import {useState} from 'react'
import Web3 from 'web3';
import {twister, withdrawal} from "./tornado.js";
import Typography from '@material-ui/core/Typography';
import Card from '@material-ui/core/Card';

function App() {
  const fraxMixers = [10000, 100000];
  const [mixerAmt, setMixerAmt] = useState(fraxMixers[0])
  const [tokenSelect, setTokenSelect] = useState("ARBFRAX")
  const [web3, setWeb3] = useState()
  const [depositText, setDepositText] = useState("");
  const [provkingKey, setProvingKey] = useState();

  const handleChange = event => {
    setTokenSelect(event.target.value)
  }

  const depositTx = async () => {
    console.log("deposit pls")
    let instance = {
      currency: tokenSelect,
      amount: mixerAmt,
    }
    await twister(web3, instance)
  }

  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      window.ethereum.request({ method: 'eth_requestAccounts' });
      let web3 = new Web3(window.ethereum)
      setWeb3(web3);
    }
  }

  const changeMixerAmount = event => {
    setMixerAmt(parseInt(event.target.value));
  }

  const depositTextChanged = event => {
    setDepositText(event.target.value);
  }

  const withdrawpls = () => {
    console.log('withdrawing: ', depositText)
    withdrawal(depositText, web3, provkingKey);
  }

  const uploadedKey = async (e) => {
    console.log('got proving key...');
    let arr = await readFileDataAsBase64(e);
    setProvingKey(arr);
    alert('proving key is set.');
  }

  function readFileDataAsBase64(e) {
    const file = e.target.files[0];

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            resolve(event.target.result);
        };

        reader.onerror = (err) => {
            reject(err);
        };

        reader.readAsArrayBuffer(file);
    });
}

  return (
    <div className="App">
      <h1 style={{color: 'white'}}>TWISTER DEMO</h1>
      <button className="wallet-button" onClick={connectWallet}>
        Metermusk button
      </button>
      <Card style={{backgroundColor: '#94FEBF', margin: '50px 50px 50px 50px', height: '300px', width: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center'}}>
      <label>
          <h2>Token:</h2>
          <select value={tokenSelect} onChange={handleChange}>
            <option value={"ARBFRAX"}>ARBFRAX</option>
          </select>
        </label>
        <div className='mixer-radio'>
          <label>
            10k
            <input type="radio" value={10000} checked={mixerAmt === fraxMixers[0]} onChange={changeMixerAmount} />
          </label>
          <label>
            100k
            <input type="radio" value={100000} checked={mixerAmt === fraxMixers[1]} onChange={changeMixerAmount} />
          </label>
        </div>
        <button className="submit-button" onClick={depositTx}>
          press if u are an ape
        </button>
      </Card>
      <div>
        <input  type="text"
                label="deposit"
                value={depositText}
                onChange={depositTextChanged}/>
        <button onClick={withdrawpls}>
          withdrawal
        </button>
      </div>
      <input type="file" id="avatar"  accept="bin" onChange={uploadedKey} />
    </div>
  );
}

export default App;
