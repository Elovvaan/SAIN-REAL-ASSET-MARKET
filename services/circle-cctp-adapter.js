import * as StellarSdk from '@stellar/stellar-sdk';
import { PublicKey } from '@solana/web3.js';
import { Contract as EthersContract, JsonRpcProvider, Wallet } from 'ethers';
import { CCTP_DOMAINS } from './circle-cctp-transfer-service.js';
import { STELLAR_USDC } from './stellar-transfer-service.js';

const CONTRACTS={
  TESTNET:{tokenMessengerMinter:'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP'},
  PRODUCTION:{tokenMessengerMinter:'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL'},
};
const EVM_NETWORKS=new Set(['ETHEREUM','AVALANCHE','OPTIMISM','ARBITRUM','BASE','POLYGON']);
const RECEIVE_MESSAGE_ABI=['function receiveMessage(bytes message, bytes attestation) returns (bool)'];

function text(value){return String(value??'').trim();}
function mode(environment){const value=text(environment.CIRCLE_CCTP_MODE||'TESTNET').toUpperCase();if(!CONTRACTS[value])throw new Error('CIRCLE_CCTP_MODE must be TESTNET or PRODUCTION.');return value;}
function decimalSubunits(value,decimals){const [whole,fraction='']=String(value).split('.');return BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction+'0'.repeat(decimals)).slice(0,decimals));}
function destinationBytes(network,address){
  if(EVM_NETWORKS.has(network))return Buffer.from(address.slice(2).padStart(64,'0'),'hex');
  if(network==='SOLANA')return new PublicKey(address).toBuffer();
  throw new Error(`Destination address encoding is unavailable for ${network}.`);
}

export class CircleCctpAdapter {
  constructor({environment=process.env,fetchImpl=globalThis.fetch}={}){
    this.environment=environment;this.fetchImpl=fetchImpl;this.mode=mode(environment);this.contracts=CONTRACTS[this.mode];
    this.passphrase=this.mode==='PRODUCTION'?StellarSdk.Networks.PUBLIC:StellarSdk.Networks.TESTNET;
    this.rpcUrl=text(environment.STELLAR_SOROBAN_RPC_URL)||(this.mode==='TESTNET'?'https://soroban-testnet.stellar.org':'');
    this.attestationUrl=text(environment.CIRCLE_CCTP_API_URL)||(this.mode==='PRODUCTION'?'https://iris-api.circle.com':'https://iris-api-sandbox.circle.com');
  }
  signer(){const secret=text(this.environment.STELLAR_DISTRIBUTOR_SECRET);if(!secret)throw new Error('STELLAR_DISTRIBUTOR_SECRET is required for a CCTP source burn.');return StellarSdk.Keypair.fromSecret(secret);}
  usdcContract(){const asset=new StellarSdk.Asset(STELLAR_USDC.asset,STELLAR_USDC.issuerAddress);return StellarSdk.StrKey.encodeContract(Buffer.from(asset.contractId(this.passphrase),'hex'));}
  status(){return{mode:this.mode,sourceReady:Boolean(this.rpcUrl&&text(this.environment.STELLAR_DISTRIBUTOR_SECRET)),stellarRpcConfigured:Boolean(this.rpcUrl),attestationApi:this.attestationUrl,contracts:this.contracts};}
  destinationStatus(network){
    if(network==='SOLANA')return{ready:false,execution:'DESTINATION_EXECUTOR_REQUIRED',reason:'Solana CCTP destination executor is not configured.'};
    if(!EVM_NETWORKS.has(network))return{ready:false,execution:'UNSUPPORTED'};
    const prefix=`CCTP_${network}`;
    const ready=Boolean(text(this.environment[`${prefix}_RPC_URL`])&&text(this.environment[`${prefix}_PRIVATE_KEY`])&&text(this.environment[`${prefix}_MESSAGE_TRANSMITTER`]));
    return{ready,execution:'AUTOMATED_EVM_MINT',reason:ready?null:`${prefix}_RPC_URL, ${prefix}_PRIVATE_KEY, and ${prefix}_MESSAGE_TRANSMITTER are required.`};
  }
  async submitSoroban(contractId,method,args){
    if(!this.rpcUrl)throw new Error('STELLAR_SOROBAN_RPC_URL is required in CCTP production mode.');
    const signer=this.signer(),server=new StellarSdk.rpc.Server(this.rpcUrl),account=await server.getAccount(signer.publicKey());
    const transaction=new StellarSdk.TransactionBuilder(account,{fee:'10000000',networkPassphrase:this.passphrase}).addOperation(new StellarSdk.Contract(contractId).call(method,...args)).setTimeout(120).build();
    const simulation=await server.simulateTransaction(transaction);
    if(StellarSdk.rpc.Api.isSimulationError(simulation))throw new Error(`CCTP Soroban simulation failed: ${JSON.stringify(simulation)}`);
    const prepared=StellarSdk.rpc.assembleTransaction(transaction,simulation).build();prepared.sign(signer);
    const sent=await server.sendTransaction(prepared);if(sent.status==='ERROR')throw new Error(`CCTP Soroban submission failed: ${JSON.stringify(sent)}`);
    for(let attempt=0;attempt<20;attempt+=1){const result=await server.getTransaction(sent.hash);if(result.status==='SUCCESS')return sent.hash;if(result.status!=='NOT_FOUND')throw new Error(`CCTP Soroban transaction failed: ${JSON.stringify(result)}`);await new Promise((resolve)=>setTimeout(resolve,1000));}
    throw new Error(`CCTP Soroban transaction ${sent.hash} remains pending.`);
  }
  async burn(record){
    if(!this.rpcUrl)throw new Error('STELLAR_SOROBAN_RPC_URL is required in CCTP production mode.');
    const signer=this.signer(),server=new StellarSdk.rpc.Server(this.rpcUrl),latest=await server.getLatestLedger();
    const amount=decimalSubunits(record.amount,7),usdc=this.usdcContract();
    const approvalTransactionHash=await this.submitSoroban(usdc,'approve',[new StellarSdk.Address(signer.publicKey()).toScVal(),new StellarSdk.Address(this.contracts.tokenMessengerMinter).toScVal(),StellarSdk.nativeToScVal(amount,{type:'i128'}),StellarSdk.nativeToScVal(latest.sequence+100000,{type:'u32'})]);
    const burnTransactionHash=await this.submitSoroban(this.contracts.tokenMessengerMinter,'deposit_for_burn',[new StellarSdk.Address(signer.publicKey()).toScVal(),StellarSdk.nativeToScVal(amount,{type:'i128'}),StellarSdk.nativeToScVal(record.destinationDomain,{type:'u32'}),StellarSdk.xdr.ScVal.scvBytes(destinationBytes(record.destinationNetwork,record.destinationAddress)),new StellarSdk.Address(usdc).toScVal(),StellarSdk.xdr.ScVal.scvBytes(Buffer.alloc(32)),StellarSdk.nativeToScVal(0n,{type:'i128'}),StellarSdk.nativeToScVal(2000,{type:'u32'})]);
    return{approvalTransactionHash,burnTransactionHash};
  }
  async attestation(transactionHash,sourceDomain=27){
    const response=await this.fetchImpl(`${this.attestationUrl}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(transactionHash)}`,{headers:{accept:'application/json'}});
    if(response.status===404)return{status:'pending'};
    if(!response.ok)throw new Error(`Circle attestation API returned ${response.status}.`);
    const message=(await response.json())?.messages?.[0];return message||{status:'pending'};
  }
  evm(record){
    const prefix=`CCTP_${record.destinationNetwork}`,rpcUrl=text(this.environment[`${prefix}_RPC_URL`]),privateKey=text(this.environment[`${prefix}_PRIVATE_KEY`]),transmitter=text(this.environment[`${prefix}_MESSAGE_TRANSMITTER`]);
    if(!rpcUrl||!privateKey||!transmitter)throw new Error(`${record.destinationNetwork} CCTP destination executor is not configured.`);
    const provider=new JsonRpcProvider(rpcUrl),wallet=new Wallet(privateKey,provider);return{provider,contract:new EthersContract(transmitter,RECEIVE_MESSAGE_ABI,wallet)};
  }
  async mint(record){if(!EVM_NETWORKS.has(record.destinationNetwork))throw new Error(`${record.destinationNetwork} CCTP destination mint executor is unavailable.`);const{contract}=this.evm(record);const tx=await contract.receiveMessage(record.circleMessage,record.circleAttestation);return{transactionHash:tx.hash};}
  async verifyMint(record){if(!EVM_NETWORKS.has(record.destinationNetwork))throw new Error(`${record.destinationNetwork} mint verification is unavailable.`);const{provider}=this.evm(record);const receipt=await provider.getTransactionReceipt(record.destinationMintTransactionHash);if(!receipt)return{confirmed:false,reason:'transaction pending'};if(Number(receipt.status)!==1)return{confirmed:false,reason:'transaction reverted'};return{confirmed:true,blockNumber:receipt.blockNumber,amount:record.amount};}
}
