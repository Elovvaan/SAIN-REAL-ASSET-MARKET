import assert from 'node:assert/strict';
import test from 'node:test';
import { ParticipantOrderIntentService } from '../services/participant-order-intent-service.js';
import { HYBRID_MARKET_DEFINITION, HYBRID_MARKET_REFERENCE } from '../services/hybrid-liquidity-market-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.values()].filter((item) => item.__type === type).map(({ __type, ...item }) => item); }
  get(type, id) { const item = this.records.get(this.key(type, id)); if (!item) return null; const { __type, ...record } = item; return record; }
  async put(type, id, record) { this.records.set(this.key(type, id), { __type: type, ...record }); return record; }
  async lifecycle(event) { this.events.push(event); return event; }
}

test('participant order uses LIVE listing price while preserving SPOT hybrid reference lineage', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'ML-1', {
    listingId: 'ML-1', instrumentId: 'INS-1', state: 'ACTIVE', status: 'LIVE', quantity: 100,
    unit: 'SRA', pricing: { askingPrice: 1, unitPrice: 1, currency: 'USD', method: 'VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR' }, blockers: [],
  });
  await domain.put(HYBRID_MARKET_DEFINITION, 'HLM-1', {
    marketId: 'HLM-1', underlyingInstrumentId: 'INS-1', mode: 'SPOT', state: 'APPROVED_REFERENCE_MARKET',
    marketIdentity: 'SRA / USD', updatedAt: '2026-08-22T10:00:00Z',
  });
  await domain.put(HYBRID_MARKET_REFERENCE, 'HMR-1', {
    referenceId: 'HMR-1', marketId: 'HLM-1', underlyingInstrumentId: 'INS-1', referenceValue: 1.18,
    quoteCurrency: 'USD', observedAt: '2026-08-22T11:00:00Z', executablePrice: false,
  });

  const service = new ParticipantOrderIntentService(domain);
  const preview = service.preview({ listingId: 'ML-1', side: 'BUY', orderType: 'MARKET', quantity: 10 }, 'P-1');

  assert.equal(preview.unitPrice, 1);
  assert.equal(preview.estimatedNotional, 10);
  assert.equal(preview.pricingAuthority, 'MARKETPLACE_LISTING');
  assert.equal(preview.hybridSpot.marketId, 'HLM-1');
  assert.equal(preview.hybridSpot.referenceId, 'HMR-1');
  assert.equal(preview.hybridSpot.referenceValue, 1.18);
  assert.equal(preview.hybridSpot.referenceExecutable, false);
  assert.ok(preview.doesNot.includes('EXECUTE_HYBRID_REFERENCE_PRICE'));

  const record = await service.confirm({ listingId: 'ML-1', side: 'BUY', orderType: 'MARKET', quantity: 10, confirmation: 'CONFIRM' }, 'P-1');
  assert.equal(record.unitPrice, 1);
  assert.equal(record.hybridMarketId, 'HLM-1');
  assert.equal(record.hybridReferenceId, 'HMR-1');
  assert.equal(record.hybridReferenceValue, 1.18);
  assert.equal(record.hybridReferenceExecutable, false);
  assert.equal(record.state, 'QUEUED_FOR_ORDER_REVIEW');
  assert.equal(service.status().hybridSpotLinked, 1);
  assert.equal(domain.events[0].payload.hybridMarketId, 'HLM-1');
});

test('non-SPOT hybrid definitions never attach execution lineage to marketplace orders', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'ML-2', {
    listingId: 'ML-2', instrumentId: 'INS-2', state: 'PUBLISHED', status: 'LIVE', quantity: 50,
    unit: 'SRA', pricing: { askingPrice: 1, unitPrice: 1, currency: 'USD' }, blockers: [],
  });
  await domain.put(HYBRID_MARKET_DEFINITION, 'HLM-2', {
    marketId: 'HLM-2', underlyingInstrumentId: 'INS-2', mode: 'PERPETUAL_REFERENCE', state: 'APPROVED_REFERENCE_MARKET', updatedAt: '2026-08-22T10:00:00Z',
  });

  const service = new ParticipantOrderIntentService(domain);
  const preview = service.preview({ listingId: 'ML-2', side: 'BUY', orderType: 'MARKET', quantity: 5 }, 'P-2');
  assert.equal(preview.hybridSpot, null);

  const record = await service.confirm({ listingId: 'ML-2', side: 'BUY', orderType: 'MARKET', quantity: 5, confirmation: 'CONFIRM' }, 'P-2');
  assert.equal(record.hybridMarketId, null);
  assert.equal(record.hybridReferenceId, null);
  assert.equal(record.hybridReferenceExecutable, false);
});
