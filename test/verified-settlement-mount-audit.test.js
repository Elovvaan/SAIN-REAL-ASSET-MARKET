import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const bootstrap = read('../public/public-bootstrap.js');
const verifiedSettlement = read('../public/verified-settlement-desk.js');

function featureIndex(source) {
  return bootstrap.indexOf(`'${source}'`);
}

test('Financing capability listeners load before the Funding Operations renderer', () => {
  const rendererIndex = featureIndex('/funding-operations-ui.js');
  assert.ok(rendererIndex > -1);
  for (const source of [
    '/funding-verification-desk.js',
    '/funding-value-model-desk.js',
    '/funding-instrument-desk.js',
    '/funding-market-activation-desk.js',
    '/verified-settlement-desk.js',
  ]) {
    const capabilityIndex = featureIndex(source);
    assert.ok(capabilityIndex > -1, `${source} must be loaded by public bootstrap`);
    assert.ok(capabilityIndex < rendererIndex, `${source} must load before Funding Operations renders`);
  }
});

test('verified settlement mounts from the Financing lifecycle and never scans the page', () => {
  assert.match(verifiedSettlement, /window\.mountVerifiedSettlementDesk = mount/);
  assert.match(verifiedSettlement, /async function mount\(fundingRoot\)/);
  assert.match(verifiedSettlement, /window\.addEventListener\('sra:funding-operations-rendered'/);
  assert.match(verifiedSettlement, /event\.detail\?\.root\?\.querySelector\?\.\('\.funding-ops'\)/);
  assert.doesNotMatch(verifiedSettlement, /MutationObserver/);
  assert.doesNotMatch(verifiedSettlement, /DOMContentLoaded/);
  assert.doesNotMatch(verifiedSettlement, /document\.querySelector\('#view-root \.funding-ops'\)/);
});

test('verified settlement controls preserve confirmation, verification, and ownership recognition', () => {
  assert.match(verifiedSettlement, /\/api\/funding-marketplace-settlement\/authorizations/);
  assert.match(verifiedSettlement, /confirmations\/internal-ledger/);
  assert.match(verifiedSettlement, /settlementConfirmationId\)\}\/verify/);
  assert.match(verifiedSettlement, /authorizationId\)\}\/settle/);
  assert.match(verifiedSettlement, /Settlement confirmation registered/);
  assert.match(verifiedSettlement, /Settlement confirmation verified/);
  assert.match(verifiedSettlement, /Ownership recognized from verified settlement/);
});
