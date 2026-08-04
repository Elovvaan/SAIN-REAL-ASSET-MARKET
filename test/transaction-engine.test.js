import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionEngineService } from '../services/transaction-engine-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async lifecycle(event) { this.events.push(structuredClone(event)); return event; }
}

function seedInstrument(domain, overrides = {}) {
  const instrument = {
    instrumentId: 'SRI-TEST', instrumentType: 'SRA_VALUE_INSTRUMENT', name: 'Test Instrument',
    coinPositionId: 'CP-TEST', coinAccountId: 'CA-TEST', financialRecordId: 'FR-TEST',
    recognitionId: 'REC-TEST', observationId: 'OBS-TEST', state: 'ACTIVE',
    issuer: { type: 'SRA_PLATFORM', id: 'SRA' }, holder: { type: 'ACCOUNT', id: 'ACCOUNT-A' },
    denomination: { symbol: 'SRA', principalQuantity: 1000, sourceQuantity: 1000 },
    terms: { purpose: 'RECORDED_VALUE_OPERATION', settlementUnit: 'SRA', governingReference: 'RULE-1' },
    restrictions: [], sourceLineage: { source: { market: 'EBAY' }, evidence: { evidenceDigest: 'digest' }, conversionRule: { rate: 1 } },
    ...overrides
  };
  domain.records.set(domain.key(RECORD_TYPES.SRA_INSTRUMENT, instrument.instrumentId), structuredClone(instrument));
  return instrument;
}

test('transaction engine creates a traceable transaction from an active instrument', async () => {
  const domain = new MemoryDomain();
  seedInstrument(domain);
  const service = new TransactionEngineService(domain);
  const result = await service.createFromInstrument('SRI-TEST', {
    idempotencyKey: 'tx-001', quantity: 250,
    toParty: { type: 'ACCOUNT', id: 'ACCOUNT-B' },
    transactionType: 'INSTRUMENT_TRANSFER', settlementMethod: 'INTERNAL_RECORD', settlementRail: 'SRA'
  });
  assert.equal(result.created, true);
  assert.equal(result.transaction.state, 'INITIATED');
  assert.equal(result.transaction.quantity, 250);
  assert.equal(result.transaction.sourceLineage.instrumentId, 'SRI-TEST');
  assert.equal(result.transaction.sourceLineage.financialRecordId, 'FR-TEST');
  assert.equal(result.transaction.fromParty.id, 'ACCOUNT-A');
  assert.equal(result.transaction.toParty.id, 'ACCOUNT-B');
  assert.equal(domain.list(RECORD_TYPES.SRA_TRANSACTION).length, 1);
});

test('transaction idempotency returns the existing transaction', async () => {
  const domain = new MemoryDomain();
  seedInstrument(domain);
  const service = new TransactionEngineService(domain);
  const input = { idempotencyKey: 'same-request', quantity: 100, toParty: { type: 'ACCOUNT', id: 'ACCOUNT-B' } };
  const first = await service.createFromInstrument('SRI-TEST', input);
  const second = await service.createFromInstrument('SRI-TEST', input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.transaction.transactionId, second.transaction.transactionId);
});

test('open and completed transactions cannot exceed instrument principal', async () => {
  const domain = new MemoryDomain();
  seedInstrument(domain, { denomination: { symbol: 'SRA', principalQuantity: 100, sourceQuantity: 100 } });
  const service = new TransactionEngineService(domain);
  await service.createFromInstrument('SRI-TEST', { quantity: 75, toParty: { type: 'ACCOUNT', id: 'ACCOUNT-B' } });
  await assert.rejects(() => service.createFromInstrument('SRI-TEST', { quantity: 26, toParty: { type: 'ACCOUNT', id: 'ACCOUNT-C' } }), /exceeds/);
});

test('transaction follows authorization, execution, settlement, and completion states', async () => {
  const domain = new MemoryDomain();
  seedInstrument(domain);
  const service = new TransactionEngineService(domain);
  const { transaction } = await service.createFromInstrument('SRI-TEST', { quantity: 50, toParty: { type: 'ACCOUNT', id: 'ACCOUNT-B' } });
  const authorized = await service.changeState(transaction.transactionId, { state: 'AUTHORIZED' }, 'SRA_ADMIN');
  const executed = await service.changeState(transaction.transactionId, { state: 'EXECUTED', executionReference: 'EXEC-001', evidence: [{ type: 'AUTH_RECORD' }] }, 'SRA_ADMIN');
  const pending = await service.changeState(transaction.transactionId, { state: 'PENDING_SETTLEMENT' }, 'SRA_ADMIN');
  const completed = await service.changeState(transaction.transactionId, { state: 'COMPLETED', externalReference: 'SETTLE-001' }, 'SRA_ADMIN');
  assert.equal(authorized.state, 'AUTHORIZED');
  assert.equal(executed.execution.executionReference, 'EXEC-001');
  assert.equal(pending.settlement.state, 'PENDING');
  assert.equal(completed.state, 'COMPLETED');
  assert.equal(completed.settlement.externalReference, 'SETTLE-001');
  assert.equal(completed.statusHistory.length, 5);
});

test('invalid transaction state jumps are rejected', async () => {
  const domain = new MemoryDomain();
  seedInstrument(domain);
  const service = new TransactionEngineService(domain);
  const { transaction } = await service.createFromInstrument('SRI-TEST', { quantity: 50, toParty: { type: 'ACCOUNT', id: 'ACCOUNT-B' } });
  await assert.rejects(() => service.changeState(transaction.transactionId, { state: 'COMPLETED' }), /cannot move/);
});
