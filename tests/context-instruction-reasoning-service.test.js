import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextInstructionReasoningService } from '../services/context-instruction-reasoning-service.js';

class Domain {
  constructor() { this.records = new Map(); this.putCalls = []; }
  key(type, id) { return `${type}:${id}`; }
  async put(type, id, record) {
    this.putCalls.push({ type, id, record });
    this.records.set(this.key(type, id), record);
    return record;
  }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  }
}

async function seed(domain, overrides = {}) {
  await domain.put('PARTICIPANT', 'P-1', { participantId: 'P-1', displayName: 'House Morris Trust' });
  await domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1',
    applicantParticipantId: 'P-1',
    transactionProfile: {
      purchaserName: 'House Morris Trust',
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
    ...overrides,
  });
}

test('Phase 2 derives dealer funding instructions from recorded transaction context', async () => {
  const domain = new Domain();
  await seed(domain);
  const service = new ContextInstructionReasoningService(domain);
  const result = service.reasonForExportPackage('EXP-1');
  assert.deepEqual(result.requiredDocuments, [
    'FUNDING_SETTLEMENT',
    'DEALER_PROCESSING_INSTRUCTIONS',
    'SERVICING_PAYMENT_INSTRUCTIONS',
  ]);
  assert.equal(result.readyForInstructionGeneration, true);
  assert.equal(result.instructionPolicy.inferMissingSettlementFields, false);
  assert.equal(result.instructionPolicy.inferMissingServicingTerms, false);
});

test('Phase 2 flags unresolved transaction data rather than inventing it', async () => {
  const domain = new Domain();
  await seed(domain, { financingTransactionId: null, beneficiaryName: null, amount: 0, currency: null, closingId: null });
  await domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1',
    applicantParticipantId: 'P-1',
    transactionProfile: { vehicleYear: '2026', vehicleMake: 'Audi', vehicleModel: 'Q5' },
  });
  const service = new ContextInstructionReasoningService(domain);
  const result = service.reasonForExportPackage('EXP-1');
  assert.equal(result.readyForInstructionGeneration, false);
  assert.ok(result.unresolvedFields.includes('FINANCING_TRANSACTION_ID'));
  assert.ok(result.unresolvedFields.includes('RECIPIENT_OR_PAYEE'));
  assert.ok(result.unresolvedFields.includes('AUTHORIZED_SETTLEMENT_AMOUNT'));
  assert.ok(result.flags.some((flag) => flag.instruction === 'FLAG_DO_NOT_INFER'));
});

test('Phase 2 persists explicit record IDs and preserves retry idempotency', async () => {
  const domain = new Domain();
  await seed(domain);
  domain.putCalls = [];
  const service = new ContextInstructionReasoningService(domain);
  const first = await service.recordReasoning('EXP-1');
  const second = await service.recordReasoning('EXP-1');
  assert.equal(first.decision.decisionId, 'AD-CONTEXT-EXP-1');
  assert.equal(first.plan.planId, 'AP-CONTEXT-EXP-1');
  assert.equal(domain.list('AGENT_DECISION').length, 1);
  assert.equal(domain.list('ACTION_PLAN').length, 1);
  assert.equal(second.plan.planId, first.plan.planId);
  const reasoningWrites = domain.putCalls.filter((call) => ['AGENT_DECISION', 'ACTION_PLAN'].includes(call.type));
  assert.equal(reasoningWrites.length, 2, 'unchanged retry should not create duplicate or stale writes');
  assert.deepEqual(reasoningWrites.map((call) => call.id), ['AD-CONTEXT-EXP-1', 'AP-CONTEXT-EXP-1']);
  assert.ok(reasoningWrites.every((call) => call.record && call.id === call.record.id));
});

test('Phase 2 refreshes blocked decision and plan after missing context is corrected', async () => {
  const domain = new Domain();
  await seed(domain, { financingTransactionId: null, amount: 0, currency: null });
  const service = new ContextInstructionReasoningService(domain);

  const blocked = await service.recordReasoning('EXP-1');
  assert.equal(blocked.reasoning.readyForInstructionGeneration, false);
  assert.equal(blocked.decision.decision, 'FLAG_UNRESOLVED_CONTEXT');
  assert.equal(blocked.plan.status, 'BLOCKED_CONTEXT_REQUIRED');

  const pkg = domain.get('EXPORT_PACKAGE', 'EXP-1');
  await domain.put('EXPORT_PACKAGE', 'EXP-1', {
    ...pkg,
    financingTransactionId: 'LFA-1',
    amount: 50000,
    currency: 'USD',
  });

  const refreshed = await service.recordReasoning('EXP-1');
  assert.equal(refreshed.reasoning.readyForInstructionGeneration, true);
  assert.equal(refreshed.decision.decision, 'GENERATE_CONTEXT_REQUIRED_INSTRUCTIONS');
  assert.equal(refreshed.plan.status, 'READY');
  assert.equal(refreshed.decision.decisionId, blocked.decision.decisionId);
  assert.equal(refreshed.plan.planId, blocked.plan.planId);
  assert.equal(domain.list('AGENT_DECISION').length, 1);
  assert.equal(domain.list('ACTION_PLAN').length, 1);
});
