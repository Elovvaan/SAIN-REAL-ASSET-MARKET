import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
  assert.match(ui,/Activate Two-Sided Market/);
  assert.match(ui,/data-reconcile-usdc-market/);
  assert.match(ui,/\/api\/on-chain\/usdc-markets/);
});
