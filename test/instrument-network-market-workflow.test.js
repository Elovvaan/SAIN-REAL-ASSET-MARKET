import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('Instruments offers an explicit Stellar or XRPL Mainnet choice and records the selection',()=>{
  const ui=read('public/admin/admin-on-chain-issuance-controls.js');
  const router=read('routes/on-chain-projection-router.js');
  assert.match(ui,/\['STELLAR','XRPL'\]\.includes/);
  assert.match(ui,/\$\{esc\(item\.network\)\} Mainnet/);
  assert.match(router,/selectedOnChainNetwork/);
  assert.match(router,/INSTRUMENT_ON_CHAIN_NETWORK_ALREADY_SELECTED/);
  assert.match(router,/INSTRUMENT_ON_CHAIN_NETWORK_SELECTED/);
});

test('Stellar adapter submits a live SRA asset offer for native XLM',()=>{
  const stellar=read('services/stellar-transfer-service.js');
  assert.match(stellar,/CREATE_DEX_OFFER/);
  assert.match(stellar,/async createOffer\(/);
  assert.match(stellar,/Operation\.manageSellOffer/);
  assert.match(stellar,/buying: StellarSdk\.Asset\.native\(\)/);
  assert.match(stellar,/buyAmountXlm \?\? input\.buyAmountNative/);
  assert.match(stellar,/SELL_SRA_ASSET_FOR_XLM/);
});

test('instrument market control routes the selected asset to XLM or XRP',()=>{
  const ui=read('public/admin/admin-on-chain-issuance-controls.js');
  const router=read('routes/on-chain-projection-router.js');
  const xrpl=read('services/xrpl-transfer-service.js');
  assert.match(ui,/Step 8 · Offer on/);
  assert.match(ui,/asset\?\.network === 'XRPL' \? 'XRP' : 'XLM'/);
  assert.match(ui,/buyAmountNative/);
  assert.match(ui,/markets\/offers/);
  assert.match(xrpl,/buyAmountXrp \?\? input\.buyAmountNative/);
  assert.match(router,/Offer exceeds the recorded issued supply/);
  assert.match(router,/ON_CHAIN_MARKET_OFFER_NOT_CONFIRMED/);
});
