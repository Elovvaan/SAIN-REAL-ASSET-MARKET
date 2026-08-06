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
  async lifecycle() { return null; }
}

test('marketplace listing carries verified recorded USD value at SRA par', async () => {
  const domain = new Domain();
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, 'SRI-TEST', {
    instrumentId: 'SRI-TEST',
    state: 'DRAFT',
    name: 'Source Trade SRA Instrument',
    issuer: { type: 'SRA_PLATFORM', id: 'SRA' },
    coinPositionId: 'CP-TEST',
    financialRecordId: 'FR-TEST',
    recognitionId: 'REC-TEST',
    observationId: 'OBS-TEST',
    denomination: { symbol: 'SRA', principalQuantity: 3481 },
    sourceLineage: { source: { asset: 'BTC' } }
  });
  const service = new MarketplaceListingService(domain, { autoStart: false });
  const { listing } = await service.prepareFromInstrument('SRI-TEST');
  assert.equal(listing.quantity, 3481);
  assert.equal(listing.verifiedRecordedValueUsd, 3481);
  assert.equal(listing.faceValueUsd, 3481);
  assert.equal(listing.pricing.askingPrice, 1);
  assert.equal(listing.pricing.method, SRA_PAR_PRICING_METHOD);
  assert.equal(listing.pricing.parReference, '1 SRA = 1 USD');
  assert.equal(listing.blockers.includes('LISTING_PRICE_REQUIRED'), false);
});

test('legacy prepared listing is projected and persisted at SRA par during readiness', async () => {
  const domain = new Domain();
  await domain.put('MARKETPLACE_LISTING', 'ML-LEGACY', {
    listingId: 'ML-LEGACY',
    instrumentId: 'SRI-LEGACY',
    state: 'PREPARED',
    unit: 'SRA',
    quantity: 96556.52,
    pricing: { state: 'NOT_SET', askingPrice: null, currency: 'USD' },
    blockers: ['ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED', 'LISTING_PRICE_REQUIRED', 'MARKET_ACCESS_RULES_REQUIRED', 'TRANSACTION_ROUTE_REQUIRED', 'SETTLEMENT_ROUTE_REQUIRED'],
    readiness: { pricingApproved: false }
  });
  const marketplace = new MarketplaceListingService(domain, { autoStart: false });
  const projected = marketplace.get('ML-LEGACY');
  assert.equal(projected.pricing.askingPrice, 1);
  assert.equal(projected.faceValueUsd, 96556.52);

  const readiness = new ListingReadinessBatchService(domain);
  await readiness.approve({ approval: 'APPROVE' }, 'ADMIN');
  const persisted = domain.get('MARKETPLACE_LISTING', 'ML-LEGACY');
  assert.equal(persisted.quantity, 96556.52);
  assert.equal(persisted.pricing.askingPrice, 1);
  assert.equal(persisted.pricing.method, SRA_PAR_PRICING_METHOD);
  assert.equal(persisted.faceValueUsd, 96556.52);
  assert.deepEqual(persisted.blockers, []);
});
