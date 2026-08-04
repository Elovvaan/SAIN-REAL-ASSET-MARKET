import test from 'node:test';
import assert from 'node:assert/strict';
import { InstrumentEngineService } from '../services/instrument-engine-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async lifecycle(event) { this.events.push(structuredClone(event)); return event; }
}

function seedCoinPosition(domain, overrides = {}) {
  const position = {
    coinPositionId: 'CP-TEST', coinAccountId: 'CA-TEST', financialRecordId: 'FR-TEST', financialAccountId: 'FRA-TEST',
    recognitionId: 'REC-TEST', observationId: 'OBS-TEST', symbol: 'SRA', quantity: 1000, state: 'ACTIVE',
    rights: [{ type: 'RECORDED_POSITION_RIGHT' }], obligations: [{ type: 'SOURCE_MAINTENANCE' }], restrictions: [],
    conversionRule: { method: 'DIRECT_RATIO', rate: 1, sourceUnit: 'USD', coinUnit: 'SRA' },
    sourceLineage: { source: { market: 'EBAY' }, evidence: { evidenceDigest: 'digest' } },
    ...overrides
  };
  domain.records.set(domain.key(RECORD_TYPES.COIN_POSITION, position.coinPositionId), structuredClone(position));
  return position;
}

test('instrument engine creates a traceable draft instrument from a coin position', async () => {
  const domain = new MemoryDomain();
  seedCoinPosition(domain);
  const service = new InstrumentEngineService(domain);
  const result = await service.createFromCoinPosition('CP-TEST', {
    name: 'Equipment Value Instrument', instrumentType: 'ASSET_VALUE_INSTRUMENT', principalQuantity: 750,
    purpose: 'CAPITAL_FORMATION', issueDate: '2026-08-04T00:00:00Z', maturityDate: '2027-08-04T00:00:00Z',
    rights: [{ type: 'PAYMENT_RIGHT' }], obligations: [{ type: 'MATURITY_OBLIGATION' }]
  });
  assert.equal(result.created, true);
  assert.equal(result.instrument.state, 'DRAFT');
  assert.equal(result.instrument.denomination.principalQuantity, 750);
  assert.equal(result.instrument.sourceLineage.coinPositionId, 'CP-TEST');
  assert.equal(result.instrument.sourceLineage.financialRecordId, 'FR-TEST');
  assert.equal(result.instrument.terms.maturityDate, '2027-08-04T00:00:00Z');
  assert.equal(result.instrument.rights.length, 2);
  assert.equal(domain.list(RECORD_TYPES.SRA_INSTRUMENT).length, 1);
});

test('instrument engine prevents duplicate open instruments from one coin position', async () => {
  const domain = new MemoryDomain();
  seedCoinPosition(domain);
  const service = new InstrumentEngineService(domain);
  const first = await service.createFromCoinPosition('CP-TEST', { name: 'First' });
  const second = await service.createFromCoinPosition('CP-TEST', { name: 'Second' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.instrument.instrumentId, second.instrument.instrumentId);
});

test('instrument principal cannot exceed represented coin quantity', async () => {
  const domain = new MemoryDomain();
  seedCoinPosition(domain, { quantity: 100 });
  const service = new InstrumentEngineService(domain);
  await assert.rejects(() => service.createFromCoinPosition('CP-TEST', { name: 'Too Large', principalQuantity: 101 }), /cannot exceed/);
});

test('instrument state changes preserve history', async () => {
  const domain = new MemoryDomain();
  seedCoinPosition(domain);
  const service = new InstrumentEngineService(domain);
  const { instrument } = await service.createFromCoinPosition('CP-TEST', { name: 'Lifecycle Instrument' });
  const active = await service.changeState(instrument.instrumentId, { state: 'ACTIVE', reason: 'Terms recorded and activated.' }, 'SRA_ADMIN');
  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.statusHistory.length, 2);
  assert.equal(active.statusHistory[1].actorId, 'SRA_ADMIN');
  assert.ok(active.activatedAt);
});
