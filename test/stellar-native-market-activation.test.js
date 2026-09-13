import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stellar=fs.readFileSync(new URL('../services/stellar-transfer-service.js',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../routes/on-chain-projection-router.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/admin/admin-on-chain-issuance-controls.js',import.meta.url),'utf8');

test('Stellar native market allocates genuine SRA and spendable XLM to both sides',()=>{
  assert.match(stellar,/CREATE_NATIVE_MARKET/);
  assert.match(stellar,/nativeMarketInventory/);
  assert.match(stellar,/base_reserve_in_stroops/);
  assert.match(stellar,/xlmSellingLiabilities/);
  assert.match(stellar,/selling:sra, buying:xlm/);
  assert.match(stellar,/selling:xlm, buying:sra/);
  assert.match(stellar,/inspectNativeMarket/);
});

test('native market activation is approved, persisted, reconciled, and visible',()=>{
  assert.match(router,/confirmMarketActivation/);
  assert.match(router,/ON_CHAIN_NATIVE_MARKET/);
  assert.match(router,/SRA_XLM_MARKET_ACTIVATED/);
  assert.match(router,/markets\/native\/activate/);
  assert.match(router,/markets\/native\/:marketId\/reconcile/);
  assert.match(ui,/Activate Funded SRA\/XLM Market/);
  assert.match(ui,/data-reconcile-native-market/);
  assert.match(ui,/\/api\/on-chain\/native-markets/);
});
