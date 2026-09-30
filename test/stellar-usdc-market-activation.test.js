import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarTransferService } from '../services/stellar-transfer-service.js';

const stellar=fs.readFileSync(new URL('../services/stellar-transfer-service.js',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../routes/on-chain-projection-router.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/admin/admin-on-chain-issuance-controls.js',import.meta.url),'utf8');

test('Stellar activates a funded two-sided SRAUSD/USDC order book',()=>{
  assert.match(stellar,/activateUsdcMarket/);
  assert.match(stellar,/Market allocation exceeds the live uncommitted distribution balance/);
  assert.match(stellar,/sellingLiabilities/);
  assert.match(stellar,/manageSellOffer\(\{ selling:sra, buying:usdc/);
  assert.match(stellar,/manageSellOffer\(\{ selling:usdc, buying:sra/);
  assert.match(stellar,/spreadBps/);
  assert.match(stellar,/inspectUsdcMarket/);
  assert.match(stellar,/prepareUsdcMarket/);
  assert.match(stellar,/READY_TO_RECEIVE_USDC/);
  assert.match(stellar,/server\.orderbook\(sra, usdc\)/);
});

test('market activation is governed, persisted, monitored, and exposed in Instruments',()=>{
  assert.match(router,/confirmMarketActivation/);
  assert.match(router,/ON_CHAIN_USDC_MARKET/);
  assert.match(router,/SRAUSD_USDC_MARKET_ACTIVATED/);
  assert.match(router,/markets\/usdc\/activate/);
  assert.match(router,/markets\/usdc\/prepare/);
  assert.match(router,/ON_CHAIN_USDC_MARKET_READINESS/);
  assert.match(router,/markets\/usdc\/:marketId\/reconcile/);
  assert.match(ui,/data-reconcile-usdc-market/);
  assert.match(ui,/\/api\/on-chain\/usdc-markets/);
  assert.doesNotMatch(ui,/\$\{nativeMarket\}\$\{usdcPreparation\}\$\{usdcConversion\}/);
});

test('funded SRA/USDC market submits two offers exactly at par', async()=>{
  const distributor=StellarSdk.Keypair.random();
  const issuer=StellarSdk.Keypair.random();
  const usdcIssuer=StellarSdk.Keypair.random();
  let submitted;
  const adapter=new StellarTransferService({environment:{STELLAR_NETWORK:'TESTNET',STELLAR_USDC_ISSUER:usdcIssuer.publicKey()}});
  adapter.ensure=()=>({distributor,server:{
    async loadAccount(){return new StellarSdk.Account(distributor.publicKey(),'123');},
    async submitTransaction(transaction){submitted=transaction;return{hash:'test-par-market',ledger:42};},
  }});
  adapter.assetBalance=async(asset)=>({available:asset==='USDC'?'50':'50',trustline:true});
  const asset={asset:'SRAUSD',assetAddress:`SRAUSD:${issuer.publicKey()}`};
  const market=await adapter.activateUsdcMarket(asset,{sraSellAmount:'20',usdcSellAmount:'20',usdcPerSra:'1',spreadBps:0});
  assert.equal(market.bidUsdcPerSra,'1.0000000');
  assert.equal(market.askUsdcPerSra,'1.0000000');
  assert.equal(submitted.operations.length,2);
  assert.equal(Number(submitted.operations[0].price),1);
  assert.equal(Number(submitted.operations[1].price),1);
  await assert.rejects(adapter.activateUsdcMarket(asset,{sraSellAmount:'20',usdcSellAmount:'20',usdcPerSra:'1',spreadBps:100}),/does not apply a bid\/ask spread/);
  await assert.rejects(adapter.activateUsdcMarket(asset,{sraSellAmount:'20',usdcSellAmount:'20',usdcPerSra:'0.99',spreadBps:0}),/must be 1 USDC/);
  adapter.assetBalance=async(asset)=>({available:asset==='USDC'?'0':'50',trustline:true});
  await assert.rejects(adapter.activateUsdcMarket(asset,{sraSellAmount:'20',usdcSellAmount:'20'}),/Market allocation exceeds/);
});
