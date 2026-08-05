import test from 'node:test';
import assert from 'node:assert/strict';
import { ListingPublicationBatchService } from '../services/listing-publication-batch-service.js';

class Domain {
  constructor(records = {}) {
    this.records = new Map(Object.entries(records).map(([type, values]) => [type, new Map(values.map((record) => [record.listingId || record.batchId, record]))]));
    this.events = [];
  }
  list(type) { return [...(this.records.get(type)?.values() || [])]; }
  get(type, id) { return this.records.get(type)?.get(id) || null; }
  async put(type, id, record) { if (!this.records.has(type)) this.records.set(type, new Map()); this.records.get(type).set(id, record); }
  async lifecycle(event) { this.events.push(event); }
}

function fixture() {
  return new Domain({
    MARKETPLACE_LISTING: [
      {
        listingId: 'ML-READY', instrumentId: 'INS-1', state: 'PREPARED', status: 'READY_FOR_PUBLICATION_APPROVAL',
        quantity: 100, unit: 'SRA', blockers: [], pricing: { askingPrice: 1, currency: 'USD' },
        access: { state: 'CONFIGURED' }, transactionRouteId: 'SRA_INTERNAL_MARKETPLACE', settlementRouteId: 'SRA_INTERNAL_SETTLEMENT', statusHistory: [],
      },
      { listingId: 'ML-BLOCKED', instrumentId: 'INS-2', state: 'PREPARED', status: 'PREPARED', blockers: ['LISTING_PRICE_REQUIRED'] },
    ],
  });
}

test('publication preview is read-only and includes only readiness-approved listings', () => {
  const domain = fixture();
  const preview = new ListingPublicationBatchService(domain).preview();
  assert.equal(preview.readOnly, true);
  assert.equal(preview.eligibleListingCount, 1);
  assert.deepEqual(preview.scope.listingIds, ['ML-READY']);
  assert.equal(domain.get('MARKETPLACE_LISTING', 'ML-READY').state, 'PREPARED');
});

test('publication approval makes covered listings live without creating transactions or settlement', async () => {
  const domain = fixture();
  const result = await new ListingPublicationBatchService(domain).approve({ approval: 'APPROVE' }, 'ADMIN-1');
  const listing = domain.get('MARKETPLACE_LISTING', 'ML-READY');
  assert.equal(result.publishedListingCount, 1);
  assert.equal(result.transactionsCreated, 0);
  assert.equal(result.settlementExecuted, false);
  assert.equal(listing.state, 'PUBLISHED');
  assert.equal(listing.status, 'LIVE');
  assert.equal(domain.get('MARKETPLACE_LISTING', 'ML-BLOCKED').state, 'PREPARED');
});

test('publication approval keyword is mandatory', async () => {
  const service = new ListingPublicationBatchService(fixture());
  await assert.rejects(() => service.approve({}), /Explicit administrator publication approval is required/);
});
