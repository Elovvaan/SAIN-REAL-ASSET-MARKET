import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancialRecordService } from '../services/financial-record-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  async put(type, id, value) { this.records.set(this.key(type, id), structuredClone(value)); return value; }
  async lifecycle(value) { this.events.push(structuredClone(value)); return value; }
}

function recognizedAssessment(decision = 'RECOGNIZED') {
  return {
    recognitionId: 'REC-1', observationId: 'OBS-1', decision,
    identity: { subjectType: 'MARKET_CATEGORY', subjectId: 'equipment', displayName: 'Equipment Market' },
    source: { market: 'EBAY', sourceRecordId: 'sale-1', payloadDigest: 'abc' },
    authority: { basis: 'PUBLIC_API', scope: 'MARKET_DATA' },
    evidence: { items: [{ type: 'COMPLETED_SALE' }], evidenceDigest: 'def' },
    classification: { type: 'MARKET_POSITION', category: 'equipment' },
    relationships: [{ type: 'COMPARABLE_TO', subjectId: 'asset-1' }],
    measurement: { method: 'OBSERVED_SALE', unit: 'USD', value: 8500, asOf: '2026-08-04T00:00:00Z', inputs: { saleCount: 1 } }
  };
}

test('recognized assessment becomes a persistent financial record and account', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.RECOGNITION_ASSESSMENT, 'REC-1', recognizedAssessment());
  const service = new FinancialRecordService(domain);
  const result = await service.createFromRecognition('REC-1', {
    accountName: 'Equipment Market Account',
    rights: [{ type: 'MEASUREMENT_RIGHT', scope: 'SRA_INTERNAL' }],
    obligations: [{ type: 'SOURCE_LINEAGE_MAINTENANCE' }]
  });

  assert.equal(result.created, true);
  assert.equal(result.financialRecord.state, 'RECORDED');
  assert.equal(result.financialRecord.recognizedPosition.amount, 8500);
  assert.equal(result.financialRecord.source.market, 'EBAY');
  assert.equal(result.financialRecord.rights.length, 1);
  assert.equal(result.financialRecord.obligations.length, 1);
  assert.equal(result.account.recordCount, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 1);
});

test('same recognition is idempotent', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.RECOGNITION_ASSESSMENT, 'REC-1', recognizedAssessment());
  const service = new FinancialRecordService(domain);
  const first = await service.createFromRecognition('REC-1', { accountName: 'Market Account' });
  const second = await service.createFromRecognition('REC-1', { accountName: 'Market Account' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.financialRecord.financialRecordId, second.financialRecord.financialRecordId);
});

test('non-recognized assessment cannot enter Phase 3', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.RECOGNITION_ASSESSMENT, 'REC-1', recognizedAssessment('IN_REVIEW'));
  const service = new FinancialRecordService(domain);
  await assert.rejects(() => service.createFromRecognition('REC-1', { accountName: 'Market Account' }), /Only a RECOGNIZED assessment/);
});

test('financial record state changes append history', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.RECOGNITION_ASSESSMENT, 'REC-1', recognizedAssessment());
  const service = new FinancialRecordService(domain);
  const result = await service.createFromRecognition('REC-1', { accountName: 'Market Account' });
  const updated = await service.changeState(result.financialRecord.financialRecordId, { state: 'ACTIVE', reason: 'Activated for continuing recordkeeping.' });
  assert.equal(updated.state, 'ACTIVE');
  assert.equal(updated.statusHistory.length, 2);
  assert.equal(service.summary().phase, 3);
});
