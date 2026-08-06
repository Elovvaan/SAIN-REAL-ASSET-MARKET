import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketplaceListingService } from '../services/marketplace-listing-service.js';
import { ListingReadinessBatchService } from '../services/listing-readiness-batch-service.js';
import { ParticipantOrderIntentService } from '../services/participant-order-intent-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor(records = {}) { this.records = new Map(Object.entries(records)); this.atomicCalls = []; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async lifecycle() {}
  async atomicPut(changes) { this.atomicCalls.push(changes); for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload)); return changes.map((change) => change.payload); }
}

function chain({ amount = 1250, rate = 2, state = 'DRAFT' } = {}) {
  const financialRecord = { financialRecordId: 'FR-1', recognizedPosition: { amount, unit: 'USD' }, measurement: { value: amount, unit: 'USD' } };
  const instrument = { instrumentId: 'SRI-1', state, financialRecordId: 'FR-1', coinPositionId: 'CP-1', denomination: { symbol: 'SRA', principalQuantity: amount * rate }, name: 'Test instrument', issuer: { id: 'SRA' } };
  return {
    [`${RECORD_TYPES.FINANCIAL_RECORD}:FR-1`]: financialRecord,
    [`${RECORD_TYPES.SRA_INSTRUMENT}:SRI-1`]: instrument,
  };
}

test('listing face value comes from the linked USD financial record, not represented SRA principal', async () => {
  const domain = new Domain(chain());
  const service = new MarketplaceListingService(domain, { autoStart: false });
  const { listing } = await service.prepareFromInstrument('SRI-1');
  assert.equal(listing.quantity, 1250);
  assert.equal(listing.faceValueUsd, 1250);
  assert.equal(listing.representedSraQuantity, 2500);
  assert.equal(listing.pricing.askingPrice, 1);
});

test('order execution canonicalizes a legacy live listing from the linked financial record', () => {
  const records = chain();
  records['MARKETPLACE_LISTING:ML-1'] = { listingId: 'ML-1', instrumentId: 'SRI-1', financialRecordId: 'FR-1', unit: 'SRA', quantity: 2500, pricing: { askingPrice: 2 }, state: 'PUBLISHED', status: 'LIVE' };
  const service = new ParticipantOrderIntentService(new Domain(records));
  const preview = service.preview({ listingId: 'ML-1', side: 'BUY', orderType: 'MARKET', quantity: 10 }, 'P-1');
  assert.equal(preview.unitPrice, 1);
  assert.equal(preview.verifiedRecordedValueUsd, 1250);
  assert.equal(preview.estimatedNotional, 10);
});

test('readiness rejects non-par administrator requests', () => {
  const service = new ListingReadinessBatchService(new Domain());
  assert.throws(() => service.preview({ unitPrice: 2 }), /exactly \$1\.00 per SRA/);
});

test('readiness prevalidates the complete scope and performs no partial writes', async () => {
  const valid = { listingId: 'ML-A', state: 'PREPARED', unit: 'SRA', verifiedRecordedValueUsd: 100, blockers: ['MARKET_ACCESS_RULES_REQUIRED'] };
  const invalid = { listingId: 'ML-B', state: 'PREPARED', unit: 'SRA', blockers: ['MARKET_ACCESS_RULES_REQUIRED'] };
  const domain = new Domain({ 'MARKETPLACE_LISTING:ML-A': valid, 'MARKETPLACE_LISTING:ML-B': invalid });
  const service = new ListingReadinessBatchService(domain);
  await assert.rejects(() => service.approve({ approval: 'APPROVE', unitPrice: 1 }), /was not started/);
  assert.equal(domain.atomicCalls.length, 0);
  assert.equal(domain.get('MARKETPLACE_LISTING', 'ML-A').status, undefined);
});

test('valid readiness records listings and batch in one atomic call', async () => {
  const listing = { listingId: 'ML-A', state: 'PREPARED', unit: 'SRA', verifiedRecordedValueUsd: 100, blockers: ['MARKET_ACCESS_RULES_REQUIRED'] };
  const domain = new Domain({ 'MARKETPLACE_LISTING:ML-A': listing });
  const service = new ListingReadinessBatchService(domain);
  const batch = await service.approve({ approval: 'APPROVE', unitPrice: 1 });
  assert.equal(batch.updatedListingCount, 1);
  assert.equal(domain.atomicCalls.length, 1);
  assert.equal(domain.atomicCalls[0].length, 2);
});
