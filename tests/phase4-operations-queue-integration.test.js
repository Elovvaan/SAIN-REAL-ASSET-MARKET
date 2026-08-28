import test from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedMarketOperationsQueueService } from '../services/unified-market-operations-queue-service.js';

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
  await domain.put('PARTICIPANT', 'P-1', { id: 'P-1', participantId: 'P-1', displayName: 'House Morris Trust' });
  await domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    id: 'FOR-1', opportunityId: 'FOR-1', applicantParticipantId: 'P-1',
    transactionProfile: { payeeName: 'FedEx Counterparty', repaymentTerms: {} },
  });
  await domain.put('FINANCING_CLOSING', 'FCL-1', { id: 'FCL-1', closingId: 'FCL-1', beneficiaryName: 'FedEx Counterparty' });
  await domain.put('EXPORT_PACKAGE', 'EXP-1', {
    id: 'EXP-1', exportPackageId: 'EXP-1', exportKind: 'FINANCING_DISBURSEMENT', financingTransactionId: 'FTX-1',
    closingId: 'FCL-1', opportunityId: 'FOR-1', borrowerParticipantId: 'P-1', beneficiaryName: 'FedEx Counterparty',
    amount: 125000, currency: 'USD', state: 'READY_FOR_SETTLEMENT_INSTRUCTION',
  });
}

function service(domain) {
  const actionExecution = {
    summarizePlan(plan) {
      return { status: plan ? 'READY' : 'READY', expectedCount: plan?.steps?.length || 0, resultCount: 0, completedCount: 0, awaitingAuthorityCount: 0, failedCount: 0, pendingCount: plan?.steps?.length || 0 };
    },
    async executePlan() { return { status: 'COMPLETED', results: [] }; },
  };
  return new UnifiedMarketOperationsQueueService(domain, null, null, { actionExecution });
}

test('admin queue exposes Phase 4 outside activity without claiming verification', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('TRANSACTION_PARTICIPATION_EVENT', 'TPE-1', {
    id: 'TPE-1', eventId: 'TPE-1', exportPackageId: 'EXP-1', financingTransactionId: 'FTX-1',
    eventType: 'FUNDING_PACKAGE_RECEIPT_CONFIRMED', createdAt: '2026-08-28T14:00:00.000Z',
  });

  const result = await service(domain).explainPersisted();
  const financing = result.queue.find((entry) => entry.id === 'EXP-1');

  assert.equal(financing.outcomeReconciliation.phase, 4);
  assert.equal(financing.outcomeReconciliation.status, 'EXTERNAL_ACTIVITY_RECORDED');
  assert.equal(financing.outcomeReconciliation.verified, false);
});

test('admin queue shows participant submission as awaiting external confirmation', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('TRANSACTION_PARTICIPATION_EVENT', 'TPE-2', {
    id: 'TPE-2', eventId: 'TPE-2', exportPackageId: 'EXP-1', financingTransactionId: 'FTX-1',
    eventType: 'PACKAGE_SUBMITTED_FOR_PROCESSING', createdAt: '2026-08-28T14:02:00.000Z',
  });

  const result = await service(domain).explainPersisted();
  const financing = result.queue.find((entry) => entry.id === 'EXP-1');

  assert.equal(financing.outcomeReconciliation.status, 'AWAITING_EXTERNAL_CONFIRMATION');
  assert.equal(financing.nextAction, 'AWAIT_EXTERNAL_CONFIRMATION');
  assert.match(financing.explanation, /independent confirmation/i);
});

test('admin queue shows verified Phase 4 only after recorded external result evidence', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('SRA_TRANSACTION', 'TR-1', {
    id: 'TR-1', transactionId: 'FTX-1', transactionType: 'EXTERNAL_TRANSFER_RESULT',
    exportPackageId: 'EXP-1', result: 'COMPLETED', externalReference: 'EXT-CONF-1',
  });

  const result = await service(domain).explainPersisted();
  const financing = result.queue.find((entry) => entry.id === 'EXP-1');

  assert.equal(financing.outcomeReconciliation.status, 'VERIFIED');
  assert.equal(financing.outcomeReconciliation.verified, true);
});
