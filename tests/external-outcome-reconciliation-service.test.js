import test from 'node:test';
import assert from 'node:assert/strict';
import { ExternalOutcomeReconciliationService } from '../services/external-outcome-reconciliation-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  async put(type, id, record) { this.records.set(this.key(type, id), structuredClone(record)); return structuredClone(record); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
}

async function seed(domain) {
  await domain.put('EXPORT_PACKAGE', 'EXP-1', {
    id: 'EXP-1', exportPackageId: 'EXP-1', exportKind: 'FINANCING_DISBURSEMENT',
    financingTransactionId: 'FTX-1', beneficiaryName: 'FedEx Counterparty', amount: 125000,
    currency: 'USD', state: 'READY_FOR_SETTLEMENT_INSTRUCTION',
  });
  await domain.put('ACTION_RESULT', 'AR-AP-CONTEXT-EXP-1-FUNDING_SETTLEMENT', {
    id: 'AR-AP-CONTEXT-EXP-1-FUNDING_SETTLEMENT',
    resultId: 'AR-AP-CONTEXT-EXP-1-FUNDING_SETTLEMENT',
    planId: 'AP-CONTEXT-EXP-1', planStepId: 'FUNDING_SETTLEMENT', status: 'COMPLETED',
    data: { exportPackageId: 'EXP-1' },
  });
}

test('Phase 4 treats participant submission as evidence, not verified settlement', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('TRANSACTION_PARTICIPATION_EVENT', 'TPE-1', {
    id: 'TPE-1', eventId: 'TPE-1', exportPackageId: 'EXP-1', financingTransactionId: 'FTX-1',
    eventType: 'PACKAGE_SUBMITTED_FOR_PROCESSING', createdAt: '2026-08-28T14:00:00.000Z',
    details: { externalReference: 'COUNTERPARTY-REF-1' },
  });

  const service = new ExternalOutcomeReconciliationService(domain);
  const reconciled = await service.reconcile('EXP-1');

  assert.equal(reconciled.outcome.status, 'AWAITING_EXTERNAL_CONFIRMATION');
  assert.equal(reconciled.outcome.observed.submittedForProcessing, true);
  assert.equal(reconciled.outcome.observed.verifiedSettlement, false);
  assert.match(reconciled.outcome.notes, /independent external confirmation/i);
});

test('Phase 4 records a blocking participant exception without claiming a failed settlement', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('TRANSACTION_PARTICIPATION_EVENT', 'TPE-2', {
    id: 'TPE-2', eventId: 'TPE-2', exportPackageId: 'EXP-1', financingTransactionId: 'FTX-1',
    eventType: 'PROCESSING_EXCEPTION_REPORTED', createdAt: '2026-08-28T14:05:00.000Z',
    details: { blocking: true, topic: 'ACH_PROCESSING' }, summary: 'Reference field needs clarification.',
  });

  const service = new ExternalOutcomeReconciliationService(domain);
  const reconciled = await service.reconcile('FTX-1');

  assert.equal(reconciled.outcome.status, 'EXCEPTION_REPORTED');
  assert.equal(reconciled.outcome.observed.processingExceptionCount, 1);
  assert.equal(reconciled.outcome.observed.failedSettlement, false);
});

test('Phase 4 verifies outcome only from recorded transfer or settlement evidence', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('TRANSACTION_PARTICIPATION_EVENT', 'TPE-3', {
    id: 'TPE-3', eventId: 'TPE-3', exportPackageId: 'EXP-1', financingTransactionId: 'FTX-1',
    eventType: 'PACKAGE_SUBMITTED_FOR_PROCESSING', createdAt: '2026-08-28T14:10:00.000Z',
  });
  await domain.put('SRA_TRANSACTION', 'TR-1', {
    id: 'TR-1', transactionId: 'FTX-1', transactionType: 'EXTERNAL_TRANSFER_RESULT',
    exportPackageId: 'EXP-1', result: 'COMPLETED', externalReference: 'BANK-CONF-1',
  });

  const service = new ExternalOutcomeReconciliationService(domain);
  const reconciled = await service.reconcile('EXP-1');

  assert.equal(reconciled.outcome.status, 'VERIFIED');
  assert.equal(reconciled.outcome.observed.verifiedExternalTransfer, true);
  assert.equal(reconciled.outcome.evidence.some((evidence) => evidence.externalReference === 'BANK-CONF-1'), true);
});

test('Phase 4 records failed external evidence as failed outcome', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('SRA_TRANSACTION', 'TR-2', {
    id: 'TR-2', transactionId: 'FTX-1', transactionType: 'EXTERNAL_TRANSFER_RESULT',
    exportPackageId: 'EXP-1', result: 'FAILED', failureReason: 'RETURNED',
  });

  const service = new ExternalOutcomeReconciliationService(domain);
  const reconciled = await service.reconcile('EXP-1');

  assert.equal(reconciled.outcome.status, 'FAILED_EXTERNAL_OUTCOME');
  assert.equal(reconciled.outcome.observed.failedExternalTransfer, true);
  assert.equal(service.summary('EXP-1').attentionRequired, true);
});

test('Phase 4 is idempotent when the external evidence set has not changed', async () => {
  const domain = new Domain();
  await seed(domain);
  const service = new ExternalOutcomeReconciliationService(domain);

  const first = await service.reconcile('EXP-1');
  const second = await service.reconcile('EXP-1');

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(domain.list('OUTCOME_EVALUATION').length, 1);
  assert.equal(domain.list('OPERATIONAL_MEMORY').length, 1);
});
