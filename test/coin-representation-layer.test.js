import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancialRecordService } from '../services/financial-record-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async lifecycle(event) { this.events.push(structuredClone(event)); return event; }
}

function financialRecord(overrides = {}) {
  return {
    financialRecordId: 'FR-1001',
    financialAccountId: 'FRA-1001',
    recognitionId: 'REC-1001',
    observationId: 'OBS-1001',
    identity: { subjectType: 'MARKET', subjectId: 'EBAY-EQUIPMENT' },
    source: { market: 'EBAY', sourceRecordId: 'MARKET-SNAPSHOT-1' },
    evidence: { evidenceDigest: 'digest-1' },
    recognizedPosition: { amount: 1250, unit: 'USD', asOf: '2026-08-04T00:00:00Z', basis: 'MARKET_MEASUREMENT' },
    rights: [{ type: 'REPRESENTATION_RIGHT' }],
    obligations: [{ type: 'SOURCE_TRACEABILITY' }],
    restrictions: [],
    state: 'RECORDED',
    recordedAt: '2026-08-04T00:00:00Z',
    ...overrides
  };
}

test('financial record is represented as an SRA coin position with full lineage', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.FINANCIAL_RECORD, 'FR-1001', financialRecord());
  const service = new FinancialRecordService(domain);

  const result = await service.representAsCoin('FR-1001', { conversionRate: 1, symbol: 'SRA' });

  assert.equal(result.created, true);
  assert.equal(result.coinPosition.quantity, 1250);
  assert.equal(result.coinPosition.symbol, 'SRA');
  assert.equal(result.coinPosition.sourceLineage.financialRecordId, 'FR-1001');
  assert.equal(result.coinPosition.state, 'REPRESENTED');
  assert.equal(result.coinAccount.representedQuantity, 1250);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 1);
});

test('coin representation is idempotent for the same active financial record', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.FINANCIAL_RECORD, 'FR-1001', financialRecord());
  const service = new FinancialRecordService(domain);

  const first = await service.representAsCoin('FR-1001', { conversionRate: 2 });
  const second = await service.representAsCoin('FR-1001', { conversionRate: 2 });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.coinPosition.coinPositionId, second.coinPosition.coinPositionId);
  assert.equal(service.listCoinPositions().length, 1);
});

test('closed financial records cannot receive coin representation', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.FINANCIAL_RECORD, 'FR-1001', financialRecord({ state: 'CLOSED' }));
  const service = new FinancialRecordService(domain);

  await assert.rejects(() => service.representAsCoin('FR-1001'), /open financial record/);
});

test('coin position state changes preserve history', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.FINANCIAL_RECORD, 'FR-1001', financialRecord());
  const service = new FinancialRecordService(domain);
  const represented = await service.representAsCoin('FR-1001');

  const active = await service.changeCoinState(represented.coinPosition.coinPositionId, { state: 'ACTIVE', reason: 'Ready for the Instrument Engine.' });

  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.statusHistory.length, 2);
  assert.equal(service.summary().phase, 4);
  assert.equal(service.summary().coinBySymbol.SRA, 1250);
});
