import assert from 'node:assert/strict';
import test from 'node:test';
import { ListingReadinessPolicyService } from '../services/listing-readiness-policy-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, record) { this.records.set(this.key(type, id), structuredClone(record)); return record; }
}

function prepared(listingId) {
  return {
    listingId,
    state: 'PREPARED',
    status: 'BLOCKED',
    blockers: [
      'ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED',
      'LISTING_PRICE_REQUIRED',
      'MARKET_ACCESS_RULES_REQUIRED',
      'TRANSACTION_ROUTE_REQUIRED',
      'SETTLEMENT_ROUTE_REQUIRED',
    ],
  };
}

test('standing policy advances eligible listings to publication review without publishing', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'LIST-1', prepared('LIST-1'));
  const service = new ListingReadinessPolicyService(domain);
  await service.approve({ approval: 'APPROVE', unitPrice: 1, minimumOrder: 1 }, 'ADMIN-1');
  const result = await service.apply();
  const listing = domain.get('MARKETPLACE_LISTING', 'LIST-1');
  assert.equal(result.updatedListingCount, 1);
  assert.equal(listing.status, 'READY_FOR_PUBLICATION_APPROVAL');
  assert.equal(listing.state, 'PREPARED');
  assert.equal(listing.pricing.askingPrice, 1);
  assert.equal(result.publicationExecuted, false);
});

test('disabled policy leaves eligible listings untouched', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'LIST-2', prepared('LIST-2'));
  const service = new ListingReadinessPolicyService(domain);
  await service.approve({ approval: 'APPROVE' }, 'ADMIN-1');
  await service.disable('ADMIN-1');
  const result = await service.apply();
  assert.equal(result.updatedListingCount, 0);
  assert.equal(domain.get('MARKETPLACE_LISTING', 'LIST-2').status, 'BLOCKED');
});
