import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('XRPL adapter separates issuer and distributor signers', () => {
  const service = read('services/xrpl-transfer-service.js');
  assert.match(service, /XRPL_ISSUER_SECRET/);
  assert.match(service, /XRPL_ISSUER_ADDRESS/);
  assert.match(service, /XRPL_SECRET/);
  assert.match(service, /issuer and distribution accounts must be different/i);
});

test('XRPL SRA asset lifecycle establishes issuer settings and distributor trustline before issuance', () => {
  const service = read('services/xrpl-transfer-service.js');
  assert.match(service, /TransactionType: 'AccountSet'/);
  assert.match(service, /SetFlag: 8/);
  assert.match(service, /TransactionType: 'TrustSet'/);
  assert.match(service, /ensureIssuerSettings\(\)/);
  assert.match(service, /ensureDistributorTrustline\(asset/);
  assert.match(service, /TransactionType: 'Payment'/);
});

test('XRPL SRAUSD market offer sells issued SRA value for native XRP', () => {
  const service = read('services/xrpl-transfer-service.js');
  const router = read('routes/on-chain-projection-router.js');
  assert.match(service, /TransactionType: 'OfferCreate'/);
  assert.match(service, /TakerGets: \{ \.\.\.asset, value: sellAmount \}/);
  assert.match(service, /TakerPays: xrpToDrops\(buyAmountXrp\)/);
  assert.match(router, /assets\/:assetId\/markets\/offers/);
  assert.doesNotMatch(router, /router\.(?:get|post)\('\/(?:xrpl|dex)\//i);
});
