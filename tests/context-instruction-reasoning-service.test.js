import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextInstructionReasoningService } from '../services/context-instruction-reasoning-service.js';

class Domain {
  constructor() { this.records = new Map(); this.created = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  put(type, id, record) { this.records.set(this.key(type, id), record); return record; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  create(type, record) {
    if (!this.created.has(type)) this.created.set(type, []);
    this.created.get(type).push(record);
    return record;
  }
  list(type) {
    const prefix = `${type}:`;
    const persisted = [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
    return [...persisted, ...(this.created.get(type) || [])];
  }
}

function seed(domain, overrides = {}) {
  domain.put('PARTICIPANT', 'P-1', { participantId: 'P-1', displayName: 'House Morris Trust' });
  domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
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
  domain.put('FINANCING_CLOSING', 'FCL-1', { closingId: 'FCL-1', beneficiaryName: 'Example Dealer' });
  domain.put('EXPORT_PACKAGE', 'EXP-1', {
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

test('Phase 2 derives dealer funding instructions from recorded transaction context', () => {
  const domain = new Domain();
  seed(domain);
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

test('Phase 2 flags unresolved transaction data rather than inventing it', () => {
  const domain = new Domain();
  seed(domain, { financingTransactionId: null, beneficiaryName: null, amount: 0, currency: null, closingId: null });
  domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
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

test('Phase 2 turns context reasoning into idempotent agent decision and action plan', () => {
  const domain = new Domain();
  seed(domain);
  const service = new ContextInstructionReasoningService(domain);
  const first = service.recordReasoning('EXP-1');
  const second = service.recordReasoning('EXP-1');
  assert.equal(first.decision.decisionId, 'AD-CONTEXT-EXP-1');
  assert.equal(first.plan.planId, 'AP-CONTEXT-EXP-1');
  assert.equal(domain.list('AGENT_DECISION').length, 1);
  assert.equal(domain.list('ACTION_PLAN').length, 1);
  assert.equal(second.plan.planId, first.plan.planId);
});
