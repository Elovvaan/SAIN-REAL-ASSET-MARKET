import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancialHistoryService } from '../services/financial-history-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)); }
  async atomicPut(changes) { for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload)); return changes.map((change) => structuredClone(change.payload)); }
  async lifecycle(event) { this.events.push(structuredClone(event)); return event; }
}

test('receipt enters at recognition and becomes financial history without marketplace eligibility', async () => {
  const domain = new MemoryDomain();
  const service = new FinancialHistoryService(domain);
  const result = await service.record({
    recordOrigin: 'HISTORICAL',
    historyType: 'RETAIL_RECEIPT',
    ownerId: 'USER-1',
    sourceReference: 'RECEIPT-ABC-100',
    merchantName: 'Neighborhood Market',
    amount: 82.41,
    category: 'OUTFLOW',
    effectiveAt: '2026-08-01T18:00:00Z',
    evidenceIds: ['EVIDENCE-1'],
  }, 'USER-1');

  assert.equal(result.created, true);
  assert.equal(result.record.recordOrigin, 'HISTORICAL');
  assert.equal(result.record.economicOutcome, true);
  assert.equal(result.record.marketplaceEligible, false);
  assert.equal(result.record.instrumentEligible, false);
  assert.equal(domain.list(RECORD_TYPES.MARKET_OBSERVATION).length, 0);
  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_HISTORY_RECORD).length, 1);
  assert.equal(result.financialRecord.recognitionId, result.recognition.recognitionId);
  assert.equal(result.record.financialRecordId, result.financialRecord.financialRecordId);
});

test('bank statement and transactions can be linked as one historical outcome set', async () => {
  const domain = new MemoryDomain();
  const service = new FinancialHistoryService(domain);
  const statement = await service.record({
    financialHistoryRecordId: 'FHR-STATEMENT-1',
    recordOrigin: 'IMPORTED',
    historyType: 'BANK_STATEMENT',
    ownerId: 'USER-1',
    sourceReference: 'BANK-STMT-2026-07',
    statementPeriodStart: '2026-07-01',
    statementPeriodEnd: '2026-07-31',
  }, 'USER-1');
  const transaction = await service.record({
    financialHistoryRecordId: 'FHR-TXN-1',
    recordOrigin: 'IMPORTED',
    historyType: 'BANK_TRANSACTION',
    ownerId: 'USER-1',
    sourceReference: 'BANK-TXN-200',
    amount: 1250,
    category: 'INFLOW',
    linkedRecordIds: [statement.record.financialHistoryRecordId],
  }, 'USER-1');

  assert.deepEqual(transaction.record.linkedRecordIds, ['FHR-STATEMENT-1']);
  const summary = service.summary('USER-1');
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.inflow, 1250);
  assert.equal(summary.outflow, 0);
  assert.equal(summary.net, 1250);
});

test('explicit financial history identifiers make intake idempotent', async () => {
  const domain = new MemoryDomain();
  const service = new FinancialHistoryService(domain);
  const input = {
    financialHistoryRecordId: 'FHR-IDEMPOTENT-1',
    recordOrigin: 'HISTORICAL',
    historyType: 'PAYMENT_CONFIRMATION',
    ownerId: 'USER-1',
    sourceReference: 'CONFIRMATION-88',
    amount: 45,
  };
  const first = await service.record(input, 'USER-1');
  const second = await service.record(input, 'USER-1');
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_HISTORY_RECORD).length, 1);
  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 1);
});

test('native origin is rejected by historical intake', async () => {
  const service = new FinancialHistoryService(new MemoryDomain());
  await assert.rejects(() => service.record({ recordOrigin: 'NATIVE', historyType: 'RETAIL_RECEIPT', ownerId: 'USER-1', sourceReference: 'R-1' }), /HISTORICAL or IMPORTED/);
});
