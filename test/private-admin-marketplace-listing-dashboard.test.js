import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');

test('private admin summary exposes canonical marketplace listing readiness', () => {
  assert.match(router, /MarketplaceListingService/);
  assert.match(router, /marketplaceListings:/);
  assert.match(router, /marketplaceListingsPrepared/);
  assert.match(router, /marketplaceListingsBlocked/);
  assert.match(router, /blockerCounts/);
  assert.match(router, /MARKETPLACE_LISTINGS/);
});

test('private admin dashboard renders listing totals and blocker breakdown', () => {
  assert.match(admin, /Marketplace Listings/);
  assert.match(admin, /Marketplace Listing Readiness/);
  assert.match(admin, /listing-blockers/);
  assert.match(admin, /storedRecordCount/);
  assert.match(admin, /supersededDuplicateCount/);
  assert.match(admin, /Show Marketplace Listing status and explain every active blocker/);
});
