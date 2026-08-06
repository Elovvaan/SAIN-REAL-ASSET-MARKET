import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketplaceListingService, SRA_PAR_PRICING_METHOD } from '../services/marketplace-listing-service.js';
import { ListingReadinessBatchService } from '../services/listing-readiness-batch-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type, change.id, change.payload); return changes.map((change) => change.payload); }
  async lifecycle() { return null; }
}

test('marketplace listing carries linked Financial Record USD value at SRA par', async () => {
  const domain = new Domain();
  await domain.put(RECORD_TYPES.FINANCIAL_RECORD, 'FR-TEST', {
    financialRecordId: 'FR-TEST',
    recognizedPosition: { amount: 3481, unit: 'USD' }
  });
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, 'SRI-TEST', {
    instrumentId: 'SRI-TEST', state: 'DRAFT', name: 'Source Trade SRA Instrument',
    issuer: { type: 'SRA_PLATFORM', id: 'SRA' }, coinPositionId: 'CP-TEST', financialRecordId: 'FR-TEST',
    recognitionId: 'REC-TEST', observationId: 'OBS-TEST', denomination: { symbol: 'SRA', principalQuantity: 6962 },
    sourceLineage: { source: { asset: 'BTC' } }
  });
  const service = new MarketplaceListingService(domain, { autoStart: false });
  const { listing } = await service.prepareFromInstrument('SRI-TEST');
  assert.equal(listing.quantity, 3481);
  assert.equal(listing.representedSraQuantity, 6962);
  assert.equal(listing.verifiedRecordedValueUsd, 3481);
  assert.equal(listing.faceValueUsd, 3481);
  assert.equal(listing.pricing.askingPrice, 1);
  assert.equal(listing.pricing.method, SRA_PAR_PRICING_METHOD);
});

test('quantity-only legacy listing remains deliberately canonicalized at par', async () => {
  const domain = new Domain();
  await domain.put('MARKETPLACE_LISTING', 'ML-LEGACY', {
    listingId: 'ML-LEGACY', instrumentId: 'SRI-LEGACY', state: 'PUBLISHED', status: 'LIVE', unit: 'SRA',
    quantity: 96556.52, pricing: { state: 'CONFIGURED', askingPrice: 2, currency: 'USD' }, blockers: []
  });
  const marketplace = new MarketplaceListingService(domain, { autoStart: false });
  const projected = marketplace.get('ML-LEGACY');
  assert.equal(projected.pricing.askingPrice, 1);
  assert.equal(projected.quantity, 96556.52);
  assert.equal(projected.faceValueUsd, 96556.52);
});

test('legacy prepared listing is persisted at SRA par during readiness', async () => {
  const domain = new Domain();
  await domain.put('MARKETPLACE_LISTING', 'ML-PREPARED', {
    listingId: 'ML-PREPARED', instrumentId: 'SRI-PREPARED', state: 'PREPARED', unit: 'SRA', quantity: 100,
    pricing: { state: 'NOT_SET', askingPrice: null, currency: 'USD' },
    blockers: ['ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED', 'LISTING_PRICE_REQUIRED', 'MARKET_ACCESS_RULES_REQUIRED', 'TRANSACTION_ROUTE_REQUIRED', 'SETTLEMENT_ROUTE_REQUIRED'],
    readiness: { pricingApproved: false }
  });
  const readiness = new ListingReadinessBatchService(domain);
  await readiness.approve({ approval: 'APPROVE' }, 'ADMIN');
  const persisted = domain.get('MARKETPLACE_LISTING', 'ML-PREPARED');
  assert.equal(persisted.quantity, 100);
  assert.equal(persisted.pricing.askingPrice, 1);
  assert.equal(persisted.pricing.method, SRA_PAR_PRICING_METHOD);
});

test('one invalid linked Financial Record does not break valid marketplace reads', async () => {
  const domain = new Domain();
  await domain.put(RECORD_TYPES.FINANCIAL_RECORD, 'FR-EUR', { financialRecordId: 'FR-EUR', recognizedPosition: { amount: 50, unit: 'EUR' } });
  await domain.put('MARKETPLACE_LISTING', 'ML-BAD', { listingId: 'ML-BAD', instrumentId: 'I-BAD', financialRecordId: 'FR-EUR', state: 'PUBLISHED', status: 'LIVE', unit: 'SRA', quantity: 50, pricing: { askingPrice: 2 } });
  await domain.put('MARKETPLACE_LISTING', 'ML-GOOD', { listingId: 'ML-GOOD', instrumentId: 'I-GOOD', state: 'PUBLISHED', status: 'LIVE', unit: 'SRA', quantity: 25, pricing: { askingPrice: 4 } });
  const marketplace = new MarketplaceListingService(domain, { autoStart: false });
  const listings = marketplace.list();
  assert.equal(listings.length, 2);
  assert.equal(listings.find((item) => item.listingId === 'ML-GOOD').pricing.askingPrice, 1);
  assert.equal(listings.find((item) => item.listingId === 'ML-BAD').executionBlocked, true);
  assert.equal(marketplace.summary().invalidListingCount, 1);
});

test('missing Financial Record prevents listing persistence and leaves instrument pending', async () => {
  const domain = new Domain();
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, 'SRI-MISSING', {
    instrumentId: 'SRI-MISSING', state: 'DRAFT', name: 'Missing record', issuer: { id: 'SRA' },
    financialRecordId: 'FR-MISSING', denomination: { symbol: 'SRA', principalQuantity: 10 }
  });
  const marketplace = new MarketplaceListingService(domain, { autoStart: false });
  await assert.rejects(() => marketplace.prepareFromInstrument('SRI-MISSING'), /Linked Financial Record FR-MISSING was not found/);
  assert.equal(domain.list('MARKETPLACE_LISTING').length, 0);
  assert.equal(marketplace.pendingInstruments().some((item) => item.instrumentId === 'SRI-MISSING'), true);
});
