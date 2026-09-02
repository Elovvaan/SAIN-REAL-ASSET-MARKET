import test from 'node:test';
import assert from 'node:assert/strict';
import { TreasuryUsdcConversionService } from '../services/treasury-usdc-conversion-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';
import { StellarTransferService, STELLAR_USDC } from '../services/stellar-transfer-service.js';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type,id) { return `${type}:${id}`; }
  list(type) { const prefix=`${type}:`; return [...this.records].filter(([key])=>key.startsWith(prefix)).map(([,record])=>structuredClone(record)); }
  get(type,id) { const record=this.records.get(this.key(type,id)); return record?structuredClone(record):null; }
  async put(type,id,record) { this.records.set(this.key(type,id),structuredClone(record)); return record; }
  async atomicPut(changes) { for(const change of changes)await this.put(change.type,change.id,change.payload);return changes.map(change=>change.payload); }
}

function fixture() {
  const domain = new Domain();
  const profile = { profileId:'SRA_PLATFORM_TREASURY', name:'SRA Platform Treasury' };
  domain.records.set(domain.key(RECORD_TYPES.PLATFORM_TREASURY_PROFILE,profile.profileId),profile);
  const balances = { 'TRSY-1000-CASH-USD':4900000, 'TRSY-1020-USDC-STELLAR':0 };
  const entries = [];
  const treasury = {
    summary(){return{cashBalanceUsd:balances['TRSY-1000-CASH-USD']};},
    async approve(input){const journal={...input,entryId:'JE-USDC-1'};entries.push(journal);balances['TRSY-1000-CASH-USD']-=input.lines.find(x=>x.accountId==='TRSY-1000-CASH-USD').amount;balances['TRSY-1020-USDC-STELLAR']+=input.lines.find(x=>x.accountId==='TRSY-1020-USDC-STELLAR').amount;return{journal};},
  };
  const stellar = {
    distributionAddress() { return 'GSRASTELLARDISTRIBUTOR'; },
    async verifyIncomingUsdcPayment(transactionId, expected) { return { verified:true, transactionId, amount:expected.amount, ledger:106717509, issuerAddress:STELLAR_USDC.issuerAddress }; },
  };
  const sep24 = { status:()=>({configured:true}), async startInteractive(){return{transactionId:'ANCHOR-1',interactiveUrl:'https://anchor.example/tx/1'};} };
  return { domain, treasury, stellar, sep24, entries, balances,
    service:new TreasuryUsdcConversionService({domain,treasury,stellar,sep24}) };
}

test('governs USD to Stellar USDC conversion through verified receipt before reclassification', async () => {
  const { service, entries, balances } = fixture();
  const conversion = await service.authorize({ profileId:'SRA_PLATFORM_TREASURY', amount:100000, provider:'CONFIGURED_ANCHOR', destinationNetwork:'STELLAR', confirmLiveConversion:true }, 'ADMIN');
  assert.equal(conversion.state,'AUTHORIZED');
  assert.equal(conversion.destinationWallet,'GSRASTELLARDISTRIBUTOR');
  assert.equal(conversion.issuerAddress,STELLAR_USDC.issuerAddress);
  assert.equal(entries.length,0);

  const initiated = await service.initiate(conversion.conversionId,{},'ADMIN');
  assert.equal(initiated.state,'PROVIDER_INITIATED');
  assert.equal(initiated.providerTransactionReference,'ANCHOR-1');
  await service.confirmUsdFunding(conversion.conversionId,{usdFundingReference:'WIRE-100K'},'ADMIN');
  const received = await service.confirmUsdcReceipt(conversion.conversionId,{stellarTransactionId:'a'.repeat(64)},'ADMIN');
  assert.equal(received.state,'USDC_RECEIVED');
  assert.equal(received.receivedUsdc,100000);
  await service.reconcile(conversion.conversionId,{},'ADMIN');
  const complete = await service.reclassify(conversion.conversionId,{},'ADMIN');
  assert.equal(complete.state,'RESERVE_RECLASSIFIED');
  assert.equal(entries.length,1);
  assert.equal(balances['TRSY-1000-CASH-USD'],4800000);
  assert.equal(balances['TRSY-1020-USDC-STELLAR'],100000);
});

test('blocks invented USDC and protects committed treasury liquidity', async () => {
  const { service, stellar } = fixture();
  await assert.rejects(()=>service.authorize({profileId:'SRA_PLATFORM_TREASURY',amount:100000,provider:'CONFIGURED_ANCHOR'},'ADMIN'),/live conversion authorization/);
  const first=await service.authorize({profileId:'SRA_PLATFORM_TREASURY',amount:4800000,provider:'MANUAL_PROVIDER',confirmLiveConversion:true},'ADMIN');
  await assert.rejects(()=>service.authorize({profileId:'SRA_PLATFORM_TREASURY',amount:100001,provider:'MANUAL_PROVIDER',confirmLiveConversion:true},'ADMIN'),/uncommitted treasury liquidity/);
  await service.initiate(first.conversionId,{providerTransactionReference:'PROVIDER-1'},'ADMIN');
  await service.confirmUsdFunding(first.conversionId,{usdFundingReference:'USD-1'},'ADMIN');
  stellar.verifyIncomingUsdcPayment=async()=>({verified:false,reason:'EXPECTED_CIRCLE_USDC_PAYMENT_NOT_FOUND'});
  await assert.rejects(()=>service.confirmUsdcReceipt(first.conversionId,{stellarTransactionId:'b'.repeat(64)},'ADMIN'),/could not be verified/);
  assert.equal(service.get(first.conversionId).state,'USD_FUNDING_CONFIRMED');
  assert.equal(service.list().length,1);
  assert.equal(service.domain.list(RECORD_TYPES.TREASURY_USDC_CONVERSION).length,1);
});

test('Stellar receipt verification requires the official USDC issuer, amount, and SRA destination', async () => {
  const service = new StellarTransferService({ environment:{ STELLAR_NETWORK:'PUBLIC' } });
  const records=[{type:'payment',from:'GPROVIDER',to:'GSRA',asset_code:'USDC',asset_issuer:STELLAR_USDC.issuerAddress,amount:'100000.0000000'}];
  service.ensure=()=>({distributor:{publicKey:()=> 'GSRA'},server:{payments:()=>({forTransaction:()=>({call:async()=>({records})})})}});
  service.confirm=async transactionId=>({state:'CONFIRMED',transactionId,ledger:99});
  const verified=await service.verifyIncomingUsdcPayment('c'.repeat(64),{destinationAddress:'GSRA',amount:'100000'});
  assert.equal(verified.verified,true);
  assert.equal(verified.issuerAddress,STELLAR_USDC.issuerAddress);
  const wrongAmount=await service.verifyIncomingUsdcPayment('c'.repeat(64),{destinationAddress:'GSRA',amount:'99999'});
  assert.equal(wrongAmount.verified,false);
  assert.equal(wrongAmount.reason,'EXPECTED_CIRCLE_USDC_PAYMENT_NOT_FOUND');
});

test('reclassification posts into the canonical SRA Treasury cash and Stellar USDC accounts',async()=>{
  const domain=new Domain();
  const treasury=new TreasuryLedgerService(domain);await treasury.initialize();
  await treasury.approve({approval:'APPROVE',memo:'Opening cash',reference:'OPENING',idempotencyKey:'OPENING',lines:[{accountId:'TRSY-1000-CASH-USD',side:'DEBIT',amount:200000,currency:'USD'},{accountId:'TRSY-3000-PLATFORM-CAPITAL',side:'CREDIT',amount:200000,currency:'USD'}]},'ADMIN');
  const stellar={distributionAddress:()=> 'GSRA',verifyIncomingUsdcPayment:async(_id,expected)=>({verified:true,amount:expected.amount,ledger:100})};
  const service=new TreasuryUsdcConversionService({domain,treasury,stellar,sep24:null});
  const conversion=await service.authorize({profileId:'SRA_PLATFORM_TREASURY',amount:100000,provider:'MANUAL_PROVIDER',confirmLiveConversion:true},'ADMIN');
  await service.initiate(conversion.conversionId,{providerTransactionReference:'PROVIDER-2'},'ADMIN');
  await service.confirmUsdFunding(conversion.conversionId,{usdFundingReference:'USD-2'},'ADMIN');
  await service.confirmUsdcReceipt(conversion.conversionId,{stellarTransactionId:'d'.repeat(64)},'ADMIN');
  await service.reconcile(conversion.conversionId,{},'ADMIN');
  await service.reclassify(conversion.conversionId,{},'ADMIN');
  assert.equal(treasury.summary().cashBalanceUsd,100000);
  assert.equal(treasury.summary().stellarUsdcUsdEquivalent,100000);
});
