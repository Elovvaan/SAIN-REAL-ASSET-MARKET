import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketplaceListingService, canonicalByInstrument } from '../services/marketplace-listing-service.js';

const prepared = {
  listingId: 'LIST-OLD',
  instrumentId: 'INS-1',
  state: 'PREPARED',
  status: 'READY_FOR_PUBLICATION_APPROVAL',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const published = {
  ...prepared,
  listingId: 'LIST-LIVE',
  state: 'PUBLISHED',
  status: 'LIVE',
  publishedAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
};

test('canonical listing projection prefers published live state over an older prepared duplicate', () => {
  const result = canonicalByInstrument([prepared, published]);
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].listingId, 'LIST-LIVE');
  assert.equal(result.listings[0].state, 'PUBLISHED');
  assert.equal(result.listings[0].status, 'LIVE');
  assert.equal(result.duplicates.length, 1);
});

test('marketplace page returns full canonical lifecycle counts independent of page size', () => {
  const records = [prepared, published];
  for (let index = 2; index <= 130; index += 1) {
    records.push({
      listingId: `LIST-${index}`,
      instrumentId: `INS-${index}`,
      state: 'PUBLISHED',
      status: 'LIVE',
      updatedAt: `2026-08-05T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    });
  }
  const domain = {
    list(type) { return type === 'MARKETPLACE_LISTING' ? records : []; },
    get() { return null; },
  };
  const service = new MarketplaceListingService(domain, { autoStart: false, environment: { MARKETPLACE_LISTING_AUTO_START: 'false' } });
  const page = service.page({}, { page: 1, limit: 100 });
  assert.equal(page.listings.length, 100);
  assert.equal(page.total, 130);
  assert.equal(page.counts.LIVE, 130);
  assert.equal(page.counts.READY, 0);
  assert.equal(page.counts.PREPARED, 0);
});
