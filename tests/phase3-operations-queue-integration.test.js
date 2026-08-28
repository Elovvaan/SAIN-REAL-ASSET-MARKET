import test from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedMarketOperationsQueueService } from '../services/unified-market-operations-queue-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  async put(type, id, record) { this.records.set(this.key(type, id), record); return record; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  }
}

async function seed(domain) {
  await domain.put('PARTICIPANT', 'P-1', { participantId: 'P-1', displayName: 'House Morris Trust' });
  await domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1',
    applicantParticipantId: 'P-1',
    transactionProfile: {
      payeeName: 'Example Dealer',
      vehicleYear: '2026',
      vehicleMake: 'Audi',
      vehicleModel: 'Q5',
      vin: 'WA1EXAMPLE1234567',
      repaymentTerms: {
        paymentFrequency: 'Monthly',
        paymentAmount: 850,
        firstPaymentDate: '2026-09-27T00:00:00.000Z',
        paymentMethod: 'ACH Credit',
      },
    },
  });
  await domain.put('FINANCING_CLOSING', 'FCL-1', { closingId: 'FCL-1', beneficiaryName: 'Example Dealer' });
  await domain.put('EXPORT_PACKAGE', 'EXP-1', {
    exportPackageId: 'EXP-1',
    exportKind: 'FINANCING_DISBURSEMENT',
    financingTransactionId: 'LFA-1',
    closingId: 'FCL-1',
    opportunityId: 'FOR-1',
    borrowerParticipantId: 'P-1',
    beneficiaryName: 'Example Dealer',
    amount: 50000,
    currency: 'USD',
    state: 'READY_FOR_SETTLEMENT_INSTRUCTION',
  });
}

test('operations queue exposes Phase 3 readiness and routes execution through the current Phase 2 plan', async () => {
  const domain = new Domain();
  await seed(domain);
  const calls = [];
  const actionExecution = {
    async executePlan(planId, options) {
      calls.push({ planId, options });
      return { planId, status: 'COMPLETED', completedCount: 4, awaitingAuthorityCount: 0, failedCount: 0, results: [] };
    },
  };
  const service = new UnifiedMarketOperationsQueueService(domain, null, null, { actionExecution });

  const before = await service.explainPersisted();
  const financing = before.queue.find((entry) => entry.id === 'EXP-1');
  assert.ok(financing);
  assert.equal(financing.instructionReasoning.readyForInstructionGeneration, true);
  assert.equal(financing.actionExecution.phase, 3);
  assert.equal(financing.actionExecution.status, 'READY');

  const execution = await service.executeFinancingPlan('EXP-1');
  assert.equal(execution.status, 'COMPLETED');
  assert.deepEqual(calls, [{
    planId: 'AP-CONTEXT-EXP-1',
    options: { exportPackageId: 'EXP-1', agentId: 'SRA-EXPORT-AGENT' },
  }]);
});

test('operations queue reports persisted Phase 3 action results without advancing financing state', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('ACTION_RESULT', 'AR-AP-CONTEXT-EXP-1-FUNDING_SETTLEMENT', {
    id: 'AR-AP-CONTEXT-EXP-1-FUNDING_SETTLEMENT',
    resultId: 'AR-AP-CONTEXT-EXP-1-FUNDING_SETTLEMENT',
    planId: 'AP-CONTEXT-EXP-1',
    planStepId: 'FUNDING_SETTLEMENT',
    action: 'INCLUDE_DOCUMENT',
    status: 'COMPLETED',
  });

  const service = new UnifiedMarketOperationsQueueService(domain, null, null, {
    actionExecution: { async executePlan() { throw new Error('not used'); } },
  });
  const result = await service.explainPersisted();
  const financing = result.queue.find((entry) => entry.id === 'EXP-1');

  assert.equal(financing.actionExecution.resultCount, 1);
  assert.equal(financing.actionExecution.completedCount, 1);
  assert.equal(domain.get('EXPORT_PACKAGE', 'EXP-1').state, 'READY_FOR_SETTLEMENT_INSTRUCTION');
});
