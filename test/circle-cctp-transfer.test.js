import test from 'node:test';
import assert from 'node:assert/strict';
import { CircleCctpTransferService, CCTP_DOMAINS } from '../services/circle-cctp-transfer-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor(){this.records=new Map();}
  key(type,id){return `${type}:${id}`;}
  list(type){const prefix=`${type}:`;return[...this.records].filter(([key])=>key.startsWith(prefix)).map(([,record])=>structuredClone(record));}
  get(type,id){const record=this.records.get(this.key(type,id));return record?structuredClone(record):null;}
  async put(type,id,record){this.records.set(this.key(type,id),structuredClone(record));return record;}
}

function fixture(){
  const domain=new Domain();
  const calls=[];
  const adapter={
    status:()=>({mode:'TESTNET',sourceReady:true}),
    destinationStatus:(network)=>({ready:network==='ETHEREUM',execution:'TEST'}),
    async burn(record){calls.push(['burn',record.cctpTransferId]);return{approvalTransactionHash:'a'.repeat(64),burnTransactionHash:'b'.repeat(64)};},
    async attestation(hash,domainId){calls.push(['attest',hash,domainId]);return{status:'complete',message:'0x1234',attestation:'0xabcd'};},
    async mint(record){calls.push(['mint',record.destinationNetwork]);return{transactionHash:'0x'+'c'.repeat(64)};},
    async verifyMint(record){calls.push(['verify',record.destinationMintTransactionHash]);return{confirmed:true,blockNumber:42,amount:record.amount};},
  };
  const stellar={async assetBalance(){return{account:'GSTELLARSRA',balance:'250.0000000'};}};
  return{domain,calls,service:new CircleCctpTransferService({domain,adapter,stellar})};
}

test('records the complete Stellar to Ethereum CCTP burn-attest-mint lifecycle',async()=>{
  const{service,calls}=fixture();
  const transfer=await service.authorize({amount:'100.25',destinationNetwork:'ETHEREUM',destinationAddress:'0x'+'1'.repeat(40),confirmNetworkTransfer:true,idempotencyKey:'CCTP-TEST-1'},'ADMIN');
  assert.equal(transfer.state,'AUTHORIZED');
  assert.equal(transfer.sourceDomain,CCTP_DOMAINS.STELLAR.domain);
  assert.equal(transfer.destinationDomain,CCTP_DOMAINS.ETHEREUM.domain);
  assert.equal(transfer.transferSpeed,'STANDARD');
  await service.burn(transfer.cctpTransferId,{confirmSourceBurn:true},'ADMIN');
  await service.attest(transfer.cctpTransferId,{},'ADMIN');
  await service.mint(transfer.cctpTransferId,{confirmDestinationMint:true},'ADMIN');
  const complete=await service.reconcile(transfer.cctpTransferId,{},'ADMIN');
  assert.equal(complete.state,'RECONCILED');
  assert.equal(complete.destinationBlock,42);
  assert.deepEqual(calls.map((item)=>item[0]),['burn','attest','mint','verify']);
  assert.equal(service.domain.list(RECORD_TYPES.TREASURY_CCTP_TRANSFER).length,1);
});

test('blocks unavailable destinations, excessive balances, invalid precision, and unconfirmed burns',async()=>{
  const{service}=fixture();
  await assert.rejects(()=>service.authorize({amount:'1',destinationNetwork:'SOLANA',destinationAddress:'1'.repeat(32),confirmNetworkTransfer:true},'ADMIN'),/not configured/);
  await assert.rejects(()=>service.authorize({amount:'1.0000001',destinationNetwork:'ETHEREUM',destinationAddress:'0x'+'1'.repeat(40),confirmNetworkTransfer:true},'ADMIN'),/6 decimal/);
  await assert.rejects(()=>service.authorize({amount:'251',destinationNetwork:'ETHEREUM',destinationAddress:'0x'+'1'.repeat(40),confirmNetworkTransfer:true},'ADMIN'),/uncommitted Stellar USDC/);
  const transfer=await service.authorize({amount:'100',destinationNetwork:'ETHEREUM',destinationAddress:'0x'+'1'.repeat(40),confirmNetworkTransfer:true},'ADMIN');
  await assert.rejects(()=>service.burn(transfer.cctpTransferId,{},'ADMIN'),/Explicit confirmation/);
  assert.equal(service.get(transfer.cctpTransferId).state,'AUTHORIZED');
});

test('does not advance while Circle attestation remains pending',async()=>{
  const{service}=fixture();
  const transfer=await service.authorize({amount:'10',destinationNetwork:'ETHEREUM',destinationAddress:'0x'+'2'.repeat(40),confirmNetworkTransfer:true},'ADMIN');
  await service.burn(transfer.cctpTransferId,{confirmSourceBurn:true},'ADMIN');
  service.adapter.attestation=async()=>({status:'pending'});
  const pending=await service.attest(transfer.cctpTransferId,{},'ADMIN');
  assert.equal(pending.attestationStatus,'pending');
  assert.equal(service.get(transfer.cctpTransferId).state,'SOURCE_BURN_CONFIRMED');
});

test('treasury UI exposes a governed CCTP workflow without combining it with USD acquisition',async()=>{
  const source=await import('node:fs/promises').then((fs)=>fs.readFile(new URL('../public/admin/admin-treasury-workstation.js',import.meta.url),'utf8'));
  assert.match(source,/USDC Network Transfer · Circle CCTP/);
  assert.match(source,/source burn, Circle attestation, destination mint, and reconciliation/);
  assert.match(source,/\/api\/platform-treasury\/cctp\/transfers/);
});
