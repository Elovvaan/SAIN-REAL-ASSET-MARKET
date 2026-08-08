import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const marketplace = fs.readFileSync(new URL('../public/admin/admin-marketplace-lifecycle-workstation.js', import.meta.url), 'utf8');

test('Marketplace Lifecycle is explicitly loaded and mounted by Administration', () => {
  assert.match(bootstrap, /admin-marketplace-lifecycle-workstation\.js/);
  assert.match(bootstrap, /mountAdminMarketplaceLifecycleWorkstation\?\.\(admin\.querySelector\('\[data-workspace=\\"marketplace\\"\]'\)\)/);
  assert.match(marketplace, /window\.mountAdminMarketplaceLifecycleWorkstation = mount/);
  assert.doesNotMatch(marketplace, /MutationObserver/);
  assert.doesNotMatch(marketplace, /DOMContentLoaded/);
});

test('Marketplace Lifecycle reads authoritative stage services instead of the capped admin workspace snapshot', () => {
  assert.doesNotMatch(marketplace, /\/api\/admin\/workspaces/);
  assert.match(marketplace, /\/api\/marketplace-listings\?page=1&limit=100/);
  assert.match(marketplace, /for \(let page = 2; page <= pages; page \+= 1\)/);
  assert.match(marketplace, /\/api\/funding-marketplace-commitment\/windows/);
  assert.match(marketplace, /\/api\/funding-marketplace-commitment\/commitments/);
  assert.match(marketplace, /\/api\/funding-marketplace-allocation\/reviews/);
  assert.match(marketplace, /\/api\/funding-marketplace-allocation\/positions/);
  assert.match(marketplace, /\/api\/funding-marketplace-allocation\/settlement-preparations/);
  assert.match(marketplace, /\/api\/funding-marketplace-settlement\/reviews/);
  assert.match(marketplace, /\/api\/funding-marketplace-settlement\/authorizations/);
  assert.match(marketplace, /\/api\/funding-marketplace-settlement\/confirmations/);
});

test('Marketplace stages use lifecycle semantics instead of loose JSON keyword filters', () => {
  assert.match(marketplace, /text\(item\.status\) === 'RESERVED'/);
  assert.match(marketplace, /text\(item\.status\) === 'CONFIRMED'/);
  assert.match(marketplace, /text\(item\.status\) === 'VERIFIED'/);
  assert.match(marketplace, /isTerminalListing/);
  assert.doesNotMatch(marketplace, /JSON\.stringify\(.*ORDER/);
  assert.doesNotMatch(marketplace, /JSON\.stringify\(.*RESERV/);
});

test('Marketplace published-state normalization recognizes both publication vocabularies', () => {
  assert.match(marketplace, /publicationStatus\) === 'PUBLISHED'/);
  assert.match(marketplace, /\['PUBLISHED','ACTIVE','LIVE','LISTED'\]/);
  assert.match(marketplace, /text\(listing\?\.status\) === 'LIVE'/);
  assert.match(marketplace, /text\(listing\?\.status\) === 'ACTIVE'/);
});

test('Marketplace flow visibly reconciles all eight lifecycle stages', () => {
  for (const label of ['Prepared','Ready','Published','Orders','Reservations','Allocations','Settlement','Historical']) {
    assert.match(marketplace, new RegExp(`\\['${label}'`));
  }
  assert.match(marketplace, /Prepared → Ready → Published → Orders → Reservations → Allocations → Settlement → Historical Listings/);
  assert.match(marketplace, /Published quantity/);
  assert.match(marketplace, /Reserved quantity/);
  assert.match(marketplace, /Confirmed order quantity/);
  assert.match(marketplace, /Allocated quantity/);
  assert.match(marketplace, /Verified settlement/);
});