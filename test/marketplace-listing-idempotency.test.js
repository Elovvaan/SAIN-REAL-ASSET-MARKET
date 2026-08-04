import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketplaceListingService, deterministicListingId } from '../services/marketplace-listing-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  async put(type, id, value) { this.records.set(this.key(type, id), structuredClone(value)); return structuredClone(value); }
  async lifecycle() {}
}

function instrument(id, quantity = 100) {
  return {
    instrumentId: id,
    name: `Instrument ${id}`,
    state: 'DRAFT',
    coinPositionId: `CP-${id}`,
    financialRecordId: `FR-${id}`,
    recognitionId: `REC-${id}`,
    observationId: `OBS-${id}`,
    issuer: { type: 'SRA_PLATFORM', id: 'SAIN_REAL_ASSET_MARKET' },
    denomination: { principalQuantity: quantity, symbol: 'SRA' },
    sourceLineage: { instrumentId: id },
    createdAt: '2026-08-04T00:00:00.000Z'
  };
}

test('one instrument creates one deterministic marketplace listing', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, 'SRI-1', instrument('SRI-1'));
  const service = new MarketplaceListingService(domain, { environment: {} });

  const first = await service.prepareFromInstrument('SRI-1');
  const second = await service.prepareFromInstrument('SRI-1');

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.listing.listingId, deterministicListingId('SRI-1'));
  assert.equal(service.list().length, 1);
});

test('legacy duplicate records are consolidated in listing views and status', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'ML-OLD-1', { listingId: 'ML-OLD-1', instrumentId: 'SRI-1', state: 'PREPARED', createdAt: '2026-08-04T00:00:00.000Z' });
  await domain.put('MARKETPLACE_LISTING', 'ML-OLD-2', { listingId: 'ML-OLD-2', instrumentId: 'SRI-1', state: 'PREPARED', createdAt: '2026-08-04T00:01:00.000Z' });
  const service = new MarketplaceListingService(domain, { environment: {} });

  assert.equal(service.list().length, 1);
  assert.equal(service.summary().listingCount, 1);
  assert.equal(service.summary().storedRecordCount, 2);
  assert.equal(service.summary().supersededDuplicateCount, 1);
});

test('listing responses are paginated with a bounded page size', async () => {
  const domain = new MemoryDomain();
  const service = new MarketplaceListingService(domain, { environment: {} });
  for (let index = 1; index <= 60; index += 1) {
    await domain.put(RECORD_TYPES.SRA_INSTRUMENT, `SRI-${index}`, instrument(`SRI-${index}`, index));
    await service.prepareFromInstrument(`SRI-${index}`);
  }

  const page = service.page({}, { page: 2, limit: 25 });
  assert.equal(page.total, 60);
  assert.equal(page.page, 2);
  assert.equal(page.limit, 25);
  assert.equal(page.totalPages, 3);
  assert.equal(page.listings.length, 25);

  const bounded = service.page({}, { page: 1, limit: 1000 });
  assert.equal(bounded.limit, 100);
});