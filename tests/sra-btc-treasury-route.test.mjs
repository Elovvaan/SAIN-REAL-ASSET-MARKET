import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { SraBtcTreasuryRouteService } from '../services/sra-btc-treasury-route-service.js';
import { createSraBtcTreasuryRouteRouter } from '../routes/sra-btc-treasury-route-router.js';
import { DatabaseService } from '../services/database-service.js';
import { PersistentDomainService, RECORD_TYPES } from '../services/persistent-domain-service.js';
import { BitcoinTransferService } from '../services/bitcoin-transfer-service.js';

const address = 'bc1q09vm5lfy0j5reeulh4x5752q25uqqvz34hufdl';
function fixture({ configured = false, confirmations = 3, amount = 0.00000001, destination = address } = {}) {
  const records = new Map([
    ['COIN_POSITION', [{ coinPositionId:'CP-1', assetIdentity:'SRA_COIN', symbol:'SRA' }]],
    ['SRA_INSTRUMENT', [{ instrumentId:'INS-1', coinPositionId:'CP-1' }]],
    ['MARKETPLACE_LISTING', [{ listingId:'LIST-1', instrumentId:'INS-1', sellerId:'SRA_PLATFORM', state:'PUBLISHED', quantity:100 }]],
  ]);
  const domain = {
    async hydrate() {}, list(type) { return records.get(type) || []; },
    get(type,id) { return (records.get(type)||[]).find((item) => (item.id || item.walletId) === id) || null; },
    async put(type,id,record) { records.set(type,[...(records.get(type)||[]).filter((item)=>(item.id||item.walletId)!==id),record]); return record; },
  };
  const bitcoin = {
    status:() => ({ configured }),
    async validateReceivingAddress(value) { return { valid:value === address }; },
    async inspectIncoming(txid) { return { transactionId:txid, confirmations, outputs:[{vout:0,amount:Number(amount).toFixed(8),address:destination}].filter((item)=>item.address===address) }; },
  };
  return { domain, bitcoin, service:new SraBtcTreasuryRouteService({domain,bitcoin}) };
}

test('dedicated Bitcoin receiving address needs no BTC deposit and leaves execution unapproved', async () => {
  const {service} = fixture();
  await service.initialize();
  const wallet = await service.registerWallet({label:'SRA Bitcoin Treasury',address},'ADMIN');
  assert.equal(wallet.networkValidated,false);
  assert.equal(wallet.privateKeyStored,false);
  assert.equal(service.status().minimumBtcDeposit,'0');
  assert.equal(service.status().tradeExecution,'PREPARATION_ONLY');
  const trade = await service.prepareTrade({walletId:wallet.walletId,listingId:'LIST-1',counterpartyId:'PARTY-1',sraQuantity:'1',btcAmount:'0.00000001',expiresAt:new Date(Date.now()+60000).toISOString()},'ADMIN');
  assert.equal(trade.executionAuthorized,false);
  assert.equal(trade.destinationAddress,address);
  assert.equal(trade.state,'PREPARED');
});

test('Bitcoin receipt checks amount and confirmations without claiming SRA delivery', async () => {
  const {service,bitcoin} = fixture({configured:true,confirmations:2});
  const wallet = await service.registerWallet({label:'SRA Bitcoin Treasury',address},'ADMIN');
  const trade = await service.prepareTrade({walletId:wallet.walletId,listingId:'LIST-1',counterpartyId:'PARTY-1',sraQuantity:'1',btcAmount:'0.00000001',expiresAt:new Date(Date.now()+60000).toISOString()},'ADMIN');
  const txid='a'.repeat(64);
  const pending = await service.verifyBtcReceipt(trade.id,txid,'ADMIN');
  assert.equal(pending.state,'BTC_RECEIPT_PENDING');
  bitcoin.inspectIncoming=async()=>({transactionId:txid,confirmations:3,outputs:[{vout:0,amount:'0.00000001'}]});
  const verified=await service.verifyBtcReceipt(trade.id,txid,'ADMIN');
  assert.equal(verified.state,'BTC_RECEIPT_VERIFIED_AWAITING_SRA_DELIVERY');
  assert.equal(verified.sraDeliveryVerified,false);
  assert.equal(verified.executionAuthorized,false);
});

test('wrong BTC destination or insufficient payment cannot satisfy prepared trade', async () => {
  const {service,bitcoin} = fixture({configured:true});
  const wallet = await service.registerWallet({label:'SRA Bitcoin Treasury',address},'ADMIN');
  const trade = await service.prepareTrade({walletId:wallet.walletId,listingId:'LIST-1',counterpartyId:'PARTY-1',sraQuantity:'1',btcAmount:'0.5',expiresAt:new Date(Date.now()+60000).toISOString()},'ADMIN');
  await assert.rejects(service.verifyBtcReceipt(trade.id,'b'.repeat(64),'ADMIN'),/does not pay/);
  bitcoin.inspectIncoming=async()=>({transactionId:'b'.repeat(64),confirmations:5,outputs:[]});
  await assert.rejects(service.verifyBtcReceipt(trade.id,'b'.repeat(64),'ADMIN'),/does not pay/);
  assert.equal(service.trades()[0].state,'PREPARED');
});

test('BTC route API requires treasury operations identity', async () => {
  const {service} = fixture();
  const app=express();app.use(express.json());
  app.use('/route',createSraBtcTreasuryRouteRouter(service));
  await request(app).get('/route/status').expect(403);
  await request(app).post('/route/wallets').send({label:'SRA Bitcoin Treasury',address}).expect(403);
});

test('BTC wallet and prepared trade survive persistent-domain hydration', async () => {
  const database=new DatabaseService();
  const domain=new PersistentDomainService(database);
  await domain.put(RECORD_TYPES.COIN_POSITION,'CP-1',{coinPositionId:'CP-1',assetIdentity:'SRA_COIN',symbol:'SRA'});
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT,'INS-1',{instrumentId:'INS-1',coinPositionId:'CP-1'});
  await domain.put(RECORD_TYPES.MARKETPLACE_LISTING,'LIST-1',{listingId:'LIST-1',instrumentId:'INS-1',sellerId:'SRA_PLATFORM',state:'PUBLISHED',quantity:10});
  const bitcoin={status:()=>({configured:false})};
  const first=await new SraBtcTreasuryRouteService({domain,bitcoin}).initialize();
  const wallet=await first.registerWallet({label:'Dedicated SRA BTC',address},'ADMIN');
  const trade=await first.prepareTrade({walletId:wallet.walletId,listingId:'LIST-1',counterpartyId:'PARTY',sraQuantity:'1',btcAmount:'0.00001',expiresAt:new Date(Date.now()+60000).toISOString()},'ADMIN');
  const second=await new SraBtcTreasuryRouteService({domain:new PersistentDomainService(database),bitcoin}).initialize();
  assert.equal(second.status().wallets[0].walletId,wallet.walletId);
  assert.equal(second.status().trades[0].id,trade.id);
});

test('Bitcoin Core inspection selects only outputs paying the SRA treasury address', async () => {
  const bitcoin=new BitcoinTransferService({environment:{}});
  bitcoin.rpc=async()=>({txid:'c'.repeat(64),confirmations:4,vout:[
    {n:0,value:0.25,scriptPubKey:{address:'another-address'}},
    {n:1,value:0.00000001,scriptPubKey:{address}},
  ]});
  const evidence=await bitcoin.inspectIncoming('c'.repeat(64),address);
  assert.deepEqual(evidence.outputs,[{vout:1,amount:'0.00000001'}]);
  assert.equal(evidence.confirmations,4);
});

test('retired address is excluded from new SRA/BTC terms', async () => {
  const {service}=fixture();
  const wallet=await service.registerWallet({label:'SRA Bitcoin Treasury',address},'ADMIN');
  await service.retireWallet(wallet.walletId,'ADMIN');
  assert.equal(service.status().walletRegistered,false);
  await assert.rejects(service.prepareTrade({walletId:wallet.walletId,listingId:'LIST-1'},'ADMIN'),/Active SRA BTC treasury wallet/);
});
