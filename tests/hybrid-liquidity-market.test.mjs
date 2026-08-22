import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridLiquidityMarketService, MARKET_MODES } from '../services/hybrid-liquidity-market-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.values()].filter((item) => item.__type === type).map(({ __type, ...item }) => item); }
  get(type, id) { const item = this.records.get(this.key(type, id)); if (!item) return null; const { __type, ...record } = item; return record; }
  async put(type, id, record) { this.records.set(this.key(type, id), { __type: type, ...record }); return record; }
}

test('hybrid reference modes remain non-executable and do not enable leverage', async () => {
  const domain = new MemoryDomain();
  await domain.put('SRA_INSTRUMENT', 'INS-1', { instrumentId: 'INS-1', denomination: { symbol: 'SRA' } });
  const service = new HybridLiquidityMarketService(domain);
  const preview = service.preview({
    underlyingInstrumentId: 'INS-1',
    mode: MARKET_MODES.PERPETUAL_REFERENCE,
    referenceSources: ['SRA_VERIFIED_VALUE', 'SRA_MARKET_ACTIVITY'],
  });
  assert.equal(preview.marketIdentity, 'SRA / USD');
  assert.equal(preview.perpetualTerms.expiry, null);
  assert.equal(preview.riskBoundary.executionEnabled, false);
  assert.equal(preview.riskBoundary.leverageEnabled, false);
  assert.equal(preview.riskBoundary.fundingPaymentsEnabled, false);

  const market = await service.approveDefinition({
    approval: 'APPROVE',
    underlyingInstrumentId: 'INS-1',
    mode: MARKET_MODES.PERPETUAL_REFERENCE,
    referenceSources: ['SRA_VERIFIED_VALUE'],
  }, 'ADMIN-1');
  assert.equal(market.executionState, 'DISABLED');
  assert.equal(market.state, 'APPROVED_REFERENCE_MARKET');
  assert.equal(market.marketplaceAccess.participantOrderAvailable, false);

  const reference = await service.recordReference({ marketId: market.marketId, referenceValue: 125.25, sourceCount: 2 });
  assert.equal(reference.referenceValue, 125.25);
  assert.equal(reference.executablePrice, false);
  assert.equal(reference.settlementInstructionCreated, false);
  const refreshed = service.get(market.marketId);
  assert.equal(refreshed.latestReference.referenceId, reference.referenceId);
  assert.equal(refreshed.marketplaceAccess.hybridReferenceExecutable, false);
});

test('event-reference mode requires an explicit resolution contract', async () => {
  const domain = new MemoryDomain();
  await domain.put('SRA_INSTRUMENT', 'INS-2', { instrumentId: 'INS-2', denomination: { symbol: 'SRA' } });
  const service = new HybridLiquidityMarketService(domain);
  assert.throws(() => service.preview({ underlyingInstrumentId: 'INS-2', mode: MARKET_MODES.EVENT_REFERENCE }), /eventQuestion is required/);
  const preview = service.preview({
    underlyingInstrumentId: 'INS-2',
    mode: MARKET_MODES.EVENT_REFERENCE,
    eventQuestion: 'Will the verified operating target be reached?',
    resolutionSource: 'SRA_RECOGNITION_RECORD',
    resolutionDeadline: '2027-01-01T00:00:00Z',
  });
  assert.equal(preview.eventTerms.resolutionSource, 'SRA_RECOGNITION_RECORD');
  assert.equal(preview.riskBoundary.participantOrdersEnabled, false);
});

test('approved SPOT hybrid market hands off only to an existing LIVE marketplace listing', async () => {
  const domain = new MemoryDomain();
  await domain.put('SRA_INSTRUMENT', 'INS-SPOT', { instrumentId: 'INS-SPOT', denomination: { symbol: 'SRA' } });
  const service = new HybridLiquidityMarketService(domain);
  const market = await service.approveDefinition({
    approval: 'APPROVE',
    underlyingInstrumentId: 'INS-SPOT',
    mode: MARKET_MODES.SPOT,
    referenceSources: ['SRA_VERIFIED_VALUE'],
  }, 'ADMIN-1');

  assert.equal(market.executionState, 'DISABLED');
  assert.equal(market.marketplaceAccess.participantOrderAvailable, false);

  await domain.put('MARKETPLACE_LISTING', 'ML-SPOT', {
    listingId: 'ML-SPOT', instrumentId: 'INS-SPOT', state: 'ACTIVE', status: 'LIVE', quantity: 500,
    unit: 'SRA', pricing: { askingPrice: 1, currency: 'USD' }, blockers: [], updatedAt: '2026-08-22T12:00:00Z',
  });
  const reference = await service.recordReference({ marketId: market.marketId, referenceValue: 1.14, sourceCount: 2 });
  const connected = service.get(market.marketId);

  assert.equal(connected.marketplaceAccess.participantOrderAvailable, true);
  assert.equal(connected.marketplaceAccess.listingId, 'ML-SPOT');
  assert.equal(connected.marketplaceAccess.askingPrice, 1);
  assert.equal(connected.marketplaceAccess.pricingAuthority, 'MARKETPLACE_LISTING');
  assert.equal(connected.marketplaceAccess.hybridReferenceExecutable, false);
  assert.equal(connected.latestReference.referenceId, reference.referenceId);
  assert.equal(connected.latestReference.referenceValue, 1.14);
  assert.equal(service.status().spotOrderAvailableMarkets, 1);
});
