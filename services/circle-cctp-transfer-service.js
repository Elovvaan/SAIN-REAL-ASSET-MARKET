import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

export const CCTP_DOMAINS = Object.freeze({
  ETHEREUM:{ domain:0, addressType:'EVM' },
  AVALANCHE:{ domain:1, addressType:'EVM' },
  OPTIMISM:{ domain:2, addressType:'EVM' },
  ARBITRUM:{ domain:3, addressType:'EVM' },
  SOLANA:{ domain:5, addressType:'SOLANA' },
  BASE:{ domain:6, addressType:'EVM' },
  POLYGON:{ domain:7, addressType:'EVM' },
  STELLAR:{ domain:27, addressType:'STELLAR' },
});

const TYPE = RECORD_TYPES.TREASURY_CCTP_TRANSFER;
const ACTIVE = new Set(['AUTHORIZED','SOURCE_BURN_CONFIRMED','ATTESTATION_READY','DESTINATION_MINT_SUBMITTED']);
const PROFILE_ID = 'SRA_PLATFORM_TREASURY';

function now(){return new Date().toISOString();}
function id(){return `CCTP-${crypto.randomUUID().split('-')[0].toUpperCase()}`;}
function text(value){return String(value??'').trim();}
function required(value,field){const result=text(value);if(!result)throw new Error(`${field} is required.`);return result;}
function usdcAmount(value){
  const raw=text(value);
  if(!/^\d+(?:\.\d{1,6})?$/.test(raw)||Number(raw)<=0)throw new Error('amount must be positive USDC with no more than 6 decimal places.');
  return raw.replace(/\.0+$/,'');
}
function network(value){
  const key=required(value,'destinationNetwork').toUpperCase();
  if(key==='STELLAR')throw new Error('CCTP destination must be a different network from Stellar.');
  if(!CCTP_DOMAINS[key])throw new Error(`Unsupported CCTP destination network: ${key}.`);
  return key;
}
function address(value,kind){
  const result=required(value,'destinationAddress');
  if(kind==='EVM'&&!/^0x[a-fA-F0-9]{40}$/.test(result))throw new Error('destinationAddress must be a valid EVM address.');
  if(kind==='SOLANA'&&!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result))throw new Error('destinationAddress must be a valid Solana address.');
  return result;
}

export class CircleCctpTransferService {
  constructor({domain,adapter,stellar}={}){this.domain=domain;this.adapter=adapter;this.stellar=stellar;}
  list(filters={}){return this.domain.list(TYPE).filter((item)=>(!filters.state||item.state===filters.state)&&(!filters.destinationNetwork||item.destinationNetwork===filters.destinationNetwork)).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));}
  get(transferId){return this.domain.get(TYPE,transferId);}
  status(){return {protocol:'CIRCLE_CCTP_V2',asset:'USDC',sourceNetwork:'STELLAR',sourceDomain:27,transferMethod:'BURN_ATTEST_MINT',supportedDestinations:Object.entries(CCTP_DOMAINS).filter(([name])=>name!=='STELLAR').map(([name,data])=>({network:name,domain:data.domain,addressType:data.addressType,...(this.adapter?.destinationStatus?.(name)||{})})),...(this.adapter?.status?.()||{})};}
  async save(record,actorId,eventType){const updated={...record,updatedAt:now()};await this.domain.put(TYPE,updated.cctpTransferId,updated,{actorId,eventType});return updated;}
  requireState(transferId,expected){const record=this.get(transferId);if(!record)throw new Error('CCTP transfer not found.');if(record.state!==expected)throw new Error(`CCTP transfer must be ${expected}, not ${record.state}.`);return record;}

  async authorize(input={},actorId=null){
    if(input.confirmNetworkTransfer!==true)throw new Error('Explicit CCTP network-transfer authorization is required.');
    const destinationNetwork=network(input.destinationNetwork);
    const destination=CCTP_DOMAINS[destinationNetwork];
    const destinationReadiness=this.adapter?.destinationStatus?.(destinationNetwork)||{};
    if(destinationReadiness.ready===false)throw new Error(destinationReadiness.reason||`${destinationNetwork} CCTP destination executor is not configured.`);
    const destinationAddress=address(input.destinationAddress,destination.addressType);
    const amount=usdcAmount(input.amount);
    const duplicate=this.list().find((item)=>ACTIVE.has(item.state)&&item.idempotencyKey===text(input.idempotencyKey));
    if(text(input.idempotencyKey)&&duplicate)return duplicate;
    const balance=await this.stellar.assetBalance('USDC');
    const reserved=this.list().filter((item)=>ACTIVE.has(item.state)).reduce((sum,item)=>sum+Number(item.amount),0);
    const available=Math.max(0,Number(balance.balance)-reserved);
    if(Number(amount)>available)throw new Error(`CCTP amount exceeds uncommitted Stellar USDC of ${available}.`);
    const timestamp=now();
    return this.save({
      cctpTransferId:input.cctpTransferId||id(),profileId:PROFILE_ID,protocol:'CIRCLE_CCTP_V2',asset:'USDC',amount,
      sourceNetwork:'STELLAR',sourceDomain:27,sourceAddress:balance.account,
      destinationNetwork,destinationDomain:destination.domain,destinationAddress,
      transferSpeed:'STANDARD',finalityThreshold:2000,state:'AUTHORIZED',idempotencyKey:text(input.idempotencyKey)||null,
      sourceApprovalTransactionHash:null,sourceBurnTransactionHash:null,circleMessage:null,circleAttestation:null,
      destinationMintTransactionHash:null,authorizedBy:actorId,authorizedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,
    },actorId,'TREASURY_CCTP_TRANSFER_AUTHORIZED');
  }

  async burn(transferId,input={},actorId=null){
    if(input.confirmSourceBurn!==true)throw new Error('Explicit confirmation is required before burning source-chain USDC.');
    const record=this.requireState(transferId,'AUTHORIZED');
    const result=await this.adapter.burn(record);
    return this.save({...record,state:'SOURCE_BURN_CONFIRMED',sourceApprovalTransactionHash:required(result.approvalTransactionHash,'approvalTransactionHash'),sourceBurnTransactionHash:required(result.burnTransactionHash,'burnTransactionHash'),sourceBurnConfirmedBy:actorId,sourceBurnConfirmedAt:now()},actorId,'TREASURY_CCTP_SOURCE_BURN_CONFIRMED');
  }

  async attest(transferId,_input={},actorId=null){
    const record=this.requireState(transferId,'SOURCE_BURN_CONFIRMED');
    const result=await this.adapter.attestation(record.sourceBurnTransactionHash,record.sourceDomain);
    if(result.status!=='complete')return {...record,attestationStatus:result.status||'pending'};
    return this.save({...record,state:'ATTESTATION_READY',attestationStatus:'complete',circleMessage:required(result.message,'message'),circleAttestation:required(result.attestation,'attestation'),attestationRecordedBy:actorId,attestationRecordedAt:now()},actorId,'TREASURY_CCTP_ATTESTATION_READY');
  }

  async mint(transferId,input={},actorId=null){
    if(input.confirmDestinationMint!==true)throw new Error('Explicit confirmation is required before submitting the destination mint.');
    const record=this.requireState(transferId,'ATTESTATION_READY');
    const result=await this.adapter.mint(record);
    return this.save({...record,state:'DESTINATION_MINT_SUBMITTED',destinationMintTransactionHash:required(result.transactionHash,'transactionHash'),destinationMintSubmittedBy:actorId,destinationMintSubmittedAt:now()},actorId,'TREASURY_CCTP_DESTINATION_MINT_SUBMITTED');
  }

  async reconcile(transferId,_input={},actorId=null){
    const record=this.requireState(transferId,'DESTINATION_MINT_SUBMITTED');
    const result=await this.adapter.verifyMint(record);
    if(!result.confirmed)throw new Error(`Destination mint is not confirmed: ${result.reason||'confirmation pending'}.`);
    return this.save({...record,state:'RECONCILED',destinationLedger:result.ledger??null,destinationBlock:result.blockNumber??null,receivedAmount:String(result.amount??record.amount),reconciledBy:actorId,reconciledAt:now()},actorId,'TREASURY_CCTP_TRANSFER_RECONCILED');
  }
}
