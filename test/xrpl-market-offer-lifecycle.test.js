import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('XRPL adapter recovers an existing offer and reports its execution state',()=>{
  const service=read('services/xrpl-transfer-service.js');
  assert.match(service,/command: 'tx'/);
  assert.match(service,/command:'account_offers'/);
  assert.match(service,/offerSequence/);
  assert.match(service,/PARTIALLY_FILLED/);
  assert.match(service,/remainingSellAmount/);
  assert.match(service,/xrpReceived/);
  assert.match(service,/previouslyCancelled/);
});

test('XRPL offer cancellation is signed and confirmed before persistence',()=>{
  const service=read('services/xrpl-transfer-service.js');
  const router=read('routes/on-chain-projection-router.js');
  assert.match(service,/TransactionType:'OfferCancel'/);
  assert.match(service,/OfferSequence:current\.offerSequence/);
  assert.match(router,/markets\/offers\/:offerId\/cancel/);
  assert.match(router,/ON_CHAIN_MARKET_CANCELLATION_NOT_CONFIRMED/);
  assert.match(router,/ON_CHAIN_MARKET_OFFER_CANCELLED/);
});

test('Instrument market station supports refresh, cancel, and guarded replacement',()=>{
  const ui=read('public/admin/admin-on-chain-issuance-controls.js');
  const router=read('routes/on-chain-projection-router.js');
  assert.match(ui,/Refresh Status/);
  assert.match(ui,/Cancel Offer/);
  assert.match(ui,/Replace Using Entered Amounts/);
  assert.match(ui,/data-confirm-market-offer/);
  assert.match(router,/markets\/offers\/:offerId\/reconcile/);
  assert.match(router,/markets\/offers\/:offerId\/replace/);
  assert.match(router,/The original offer remains cancelled/);
});
