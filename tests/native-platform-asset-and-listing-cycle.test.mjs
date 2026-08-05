import test from 'node:test';
import assert from 'node:assert/strict';
import { explainAdminState } from '../services/admin-state-explanation-service.js';
import { MarketplaceListingService } from '../services/marketplace-listing-service.js';

function memoryDomain(initial = {}) {
  const records = new Map(Object.entries(initial).map(([type, values]) => [type, new Map(values.map((record) => [record.instrumentId || record.listingId || record.id, record]))]));
  return {
    list(type) { return [...(records.get(type)?.values() || [])]; },
    get(type, id) { return records.get(type)?.get(id) || null; },
    async put(type, id, record) { if (!records.has(type)) records.set(type, new Map()); records.get(type).set(id, record); return record; },
    async lifecycle() {},
  };
}

test('native platform asset wording resolves to the live asset', () => {
  const domain = memoryDomain({
    SRA_INSTRUMENT: [{ instrumentId: 'INS-NATIVE', platformAssetCode: 'SRA_PLATFORM_ASSET', state: 'ISSUED' }],
    MARKETPLACE_LISTING: [{ listingId: 'LIST-NATIVE', instrumentId: 'INS-NATIVE', state: 'PUBLISHED' }],
  });
  const answer = explainAdminState(domain, 'Where is the SRA native platform asset right now?');
  assert.equal(answer.intent, 'NATIVE_PLATFORM_ASSET_STATUS');
  assert.match(answer.answer, /INS-NATIVE/);
  assert.match(answer.answer, /lifecycle is not complete/i);
});

test('listing preparation backfill creates one prepared listing per unlisted instrument', async () => {
  const domain = memoryDomain({
    SRA_INSTRUMENT: [
      { instrumentId: 'INS-1', state: 'DRAFT', name: 'One', issuer: { id: 'SRA' }, denomination: { principalQuantity: 10, symbol: 'SRA' } },
      { instrumentId: 'INS-2', state: 'DRAFT', name: 'Two', issuer: { id: 'SRA' }, denomination: { principalQuantity: 20, symbol: 'SRA' } },
    ],
  });
  const service = new MarketplaceListingService(domain, { autoStart: false, environment: { MARKETPLACE_LISTING_PREPARATION_ENABLED: 'true' } });
  await service.backfill();
  assert.equal(service.status().listingCount, 2);
  assert.equal(service.status().pendingInstrumentCount, 0);
  assert.equal(domain.list('MARKETPLACE_LISTING').every((listing) => listing.state === 'PREPARED'), true);
});

test('prepared listings remain blocked from publication until governed approval work is complete', async () => {
  const domain = memoryDomain({
    SRA_INSTRUMENT: [{ instrumentId: 'INS-1', state: 'DRAFT', name: 'One', issuer: { id: 'SRA' }, denomination: { principalQuantity: 10, symbol: 'SRA' } }],
  });
  const service = new MarketplaceListingService(domain, { autoStart: false, environment: { MARKETPLACE_LISTING_PREPARATION_ENABLED: 'true' } });
  await service.backfill();
  const [listing] = domain.list('MARKETPLACE_LISTING');
  assert.equal(listing.state, 'PREPARED');
  assert.ok(listing.blockers.includes('ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED'));
  assert.ok(listing.blockers.includes('LISTING_PRICE_REQUIRED'));
  assert.ok(listing.blockers.includes('SETTLEMENT_ROUTE_REQUIRED'));
});
