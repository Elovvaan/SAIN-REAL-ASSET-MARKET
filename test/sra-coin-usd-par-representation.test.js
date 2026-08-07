import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancialRecordService } from '../services/financial-record-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${type}:`))
      .map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); }
  async lifecycle() {}
}

async function seedFinancialRecord(domain, { id, amount, unit, recordedValue = null }) {
  await domain.put(RECORD_TYPES.FINANCIAL_RECORD, id, {
    financialRecordId: id,
    financialAccountId: `FRA-${id}`,
    recognitionId: `REC-${id}`,
    observationId: `OBS-${id}`,
    identity: { subjectType: 'ASSET', subjectId: `SUB-${id}` },
    recognizedPosition: { amount, unit, asOf: '2026-08-07T00:00:00.000Z', basis: 'VERIFIED_SOURCE_POSITION' },
    recordedValue,
    rights: [], obligations: [], restrictions: [], state: 'RECORDED', recordedAt: '2026-08-07T00:00:00.000Z',
  });
}

test('SRA representation uses recognized USD value rather than native asset quantity', async () => {
  const domain = new MemoryDomain();
  await seedFinancialRecord(domain, {
    id: 'FR-BTC', amount: 43, unit: 'BTC', recordedValue: { amount: 2_795_000, currency: 'USD' },
  });
  const service = new FinancialRecordService(domain);
  const result = await service.representAsCoin('FR-BTC', { symbol: 'SRA', conversionRate: 1 }, 'TEST');
  assert.equal(result.coinPosition.sourcePosition.amount, 43);
  assert.equal(result.coinPosition.sourcePosition.unit, 'BTC');
  assert.equal(result.coinPosition.recordedValue.amount, 2_795_000);
  assert.equal(result.coinPosition.quantity, 2_795_000);
  assert.equal(result.coinPosition.conversionRule.method, 'RECORDED_USD_VALUE_AT_PAR');
  assert.equal(result.coinPosition.conversionRule.sourceUnit, 'USD');
  assert.equal(result.coinPosition.conversionRule.originalSourceUnit, 'BTC');
});

test('SRA representation rejects a non-USD native quantity with no recognized USD value', async () => {
  const domain = new MemoryDomain();
  await seedFinancialRecord(domain, { id: 'FR-BTC-NOVALUE', amount: 43, unit: 'BTC' });
  const service = new FinancialRecordService(domain);
  await assert.rejects(
    () => service.representAsCoin('FR-BTC-NOVALUE', { symbol: 'SRA', conversionRate: 1 }, 'TEST'),
    /requires recognized USD value.*43 BTC.*cannot be represented 1:1 as SRA/
  );
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 0);
});

test('USD-denominated recognized value remains one SRA per one USD', async () => {
  const domain = new MemoryDomain();
  await seedFinancialRecord(domain, { id: 'FR-USD', amount: 1250.75, unit: 'USD' });
  const service = new FinancialRecordService(domain);
  const result = await service.representAsCoin('FR-USD', { symbol: 'SRA', conversionRate: 1 }, 'TEST');
  assert.equal(result.coinPosition.quantity, 1250.75);
  assert.equal(result.coinPosition.recordedValue.amount, 1250.75);
});

test('SRA par representation rejects non-par conversion rates', async () => {
  const domain = new MemoryDomain();
  await seedFinancialRecord(domain, { id: 'FR-USD-RATE', amount: 100, unit: 'USD' });
  const service = new FinancialRecordService(domain);
  await assert.rejects(
    () => service.representAsCoin('FR-USD-RATE', { symbol: 'SRA', conversionRate: 2 }, 'TEST'),
    /fixed at 1 SRA per 1 recognized USD/
  );
});
