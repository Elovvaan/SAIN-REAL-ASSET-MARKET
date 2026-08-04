import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformTreasuryService } from '../services/platform-treasury-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor(){this.records=new Map();}
  key(type,id){return `${type}:${id}`;}
  list(type){const prefix=`${type}:`;return [...this.records.entries()].filter(([key])=>key.startsWith(prefix)).map(([,value])=>structuredClone(value));}
  get(type,id){const value=this.records.get(this.key(type,id));return value?structuredClone(value):null;}
  async put(type,id,value){this.records.set(this.key(type,id),structuredClone(value));return structuredClone(value);}
}

const ledger={getAccount:()=>({}),balance:()=>({balance:0})};

test('registers public hardware wallet without private material',async()=>{
  const domain=new MemoryDomain();
  const service=new PlatformTreasuryService(domain,ledger);
  const wallet=await service.registerHardwareWallet({label:'SRA Hardware Treasury',publicAddress:'0x1111111111111111111111111111111111111111'},'ADMIN');
  assert.equal(wallet.walletType,'HARDWARE');
  assert.equal(wallet.network,'BASE');
  assert.equal(wallet.asset,'USDC');
  assert.equal(wallet.privateKeyStored,false);
  assert.equal(wallet.recoveryPhraseStored,false);
  assert.equal(domain.list(RECORD_TYPES.TREASURY_CRYPTO_WALLET).length,1);
});

test('rejects duplicate active public address',async()=>{
  const domain=new MemoryDomain();
  const service=new PlatformTreasuryService(domain,ledger);
  const address='0x2222222222222222222222222222222222222222';
  await service.registerHardwareWallet({label:'Primary',publicAddress:address});
  await assert.rejects(()=>service.registerHardwareWallet({label:'Duplicate',publicAddress:address}),/already registered/i);
});

test('records confirmed activity and calculates recorded USDC balance',async()=>{
  const domain=new MemoryDomain();
  const service=new PlatformTreasuryService(domain,ledger);
  const wallet=await service.registerHardwareWallet({label:'Primary',publicAddress:'0x3333333333333333333333333333333333333333'});
  await service.recordCryptoActivity({walletId:wallet.walletId,transactionHash:`0x${'a'.repeat(64)}`,direction:'INCOMING',amount:125,state:'VERIFIED'});
  await service.recordCryptoActivity({walletId:wallet.walletId,transactionHash:`0x${'b'.repeat(64)}`,direction:'OUTGOING',amount:25,state:'CONFIRMED'});
  await service.recordCryptoActivity({walletId:wallet.walletId,transactionHash:`0x${'c'.repeat(64)}`,direction:'INCOMING',amount:10,state:'OBSERVED'});
  const position=service.cryptoWalletPosition(wallet.walletId);
  assert.equal(position.recordedUsdcBalance,100);
  assert.equal(position.verifiedIncoming,125);
  assert.equal(position.verifiedOutgoing,25);
  assert.equal(position.pendingActivity,1);
});
