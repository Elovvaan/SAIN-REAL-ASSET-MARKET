import test from 'node:test';
import assert from 'node:assert/strict';
import { ListingReadinessBatchService } from '../services/listing-readiness-batch-service.js';

class Domain {
  constructor(records = {}) { this.records = new Map(Object.entries(records).map(([type, values]) => [type, new Map(values.map((record) => [record.listingId || record.instrumentId || record.batchId, record]))])); }
  list(type) { return [...(this.records.get(type)?.values() || [])]; }
  get(type, id) { return this.records.get(type)?.get(id) || null; }
  async put(type, id, record) { if (!this.records.has(type)) this.records.set(type, new Map()); this.records.get(type).set(id, record); }
}

function fixture() {
  const blockers = ['ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED','LISTING_PRICE_REQUIRED','MARKET_ACCESS_RULES_REQUIRED','TRANSACTION_ROUTE_REQUIRED','SETTLEMENT_ROUTE_REQUIRED'];
  return new Domain({
    MARKETPLACE_LISTING: [
      { listingId: 'ML-1', instrumentId: 'INS-1', state: 'PREPARED', quantity: 100, pricing: { currency: 'USD' }, blockers },
      { listingId: 'ML-2', instrumentId: 'INS-2', state: 'PREPARED', quantity: 200, pricing: { currency: 'USD' }, blockers },
      { listingId: 'LIST-NATIVE', instrumentId: 'INS-NATIVE', platformAssetCode: 'SRA_PLATFORM_ASSET', state: 'PUBLISHED', blockers: [] },
    ],
    SRA_INSTRUMENT: [
      { instrumentId: 'INS-1', denomination: { principalQuantity: 100 } },
      { instrumentId: 'INS-2', denomination: { principalQuantity: 200 } },
    ],
  });
}

test('preview is read-only and excludes the native platform asset', () => {
  const domain = fixture();
  const service = new ListingReadinessBatchService(domain);
  const preview = service.preview();
  assert.equal(preview.readOnly, true);
  assert.equal(preview.eligibleListingCount, 2);
  assert.equal(domain.get('MARKETPLACE_LISTING', 'ML-1').blockers.length, 5);
});

test('approval moves covered listings to publication approval without publishing', async () => {
  const domain = fixture();
  const service = new ListingReadinessBatchService(domain);
  const batch = await service.approve({ approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(batch.updatedListingCount, 2);
  assert.equal(batch.publicationExecuted, false);
  for (const id of ['ML-1', 'ML-2']) {
    const listing = domain.get('MARKETPLACE_LISTING', id);
    assert.equal(listing.state, 'PREPARED');
    assert.equal(listing.status, 'READY_FOR_PUBLICATION_APPROVAL');
    assert.deepEqual(listing.blockers, []);
    assert.equal(listing.readiness.instrumentReviewed, true);
  }
});

test('approval keyword is mandatory', async () => {
  const service = new ListingReadinessBatchService(fixture());
  await assert.rejects(() => service.approve({}), /Explicit administrator approval is required/);
});
