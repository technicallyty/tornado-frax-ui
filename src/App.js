import './App.css';
import {useState} from 'react'
import Web3 from 'web3';
import {twister, withdrawal} from "./tornado.js";

function App() {
  const fraxMixers = [10000, 100000];
  const [mixerAmt, setMixerAmt] = useState(fraxMixers[0])
  const [tokenSelect, setTokenSelect] = useState("ARBFRAX")
  const [web3, setWeb3] = useState()
  const [depositText, setDepositText] = useState("");

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
    withdrawal(depositText, web3);
  }

  return (
    <div className="App">
      <button className="wallet-button" onClick={connectWallet}>
        Metermusk button
      </button>
      <div className="box">
      <label>
          Token:
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
      </div>
      <div>
        <input  type="text"
                label="deposit"
                value={depositText}
                onChange={depositTextChanged}/>
        <button onClick={withdrawpls}>
          withdrawal
        </button>
      </div>
    </div>
  );
}

export default App;
