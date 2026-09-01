import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancingIntelligenceService } from '../services/financing-intelligence-service.js';
import { TransactionFactsMappingService } from '../services/transaction-facts-mapping-service.js';
import { ExternalOutcomeReconciliationService } from '../services/external-outcome-reconciliation-service.js';

class Domain {
  constructor(seed = {}) {
    this.records = new Map();
    this.lifecycleEvents = [];
    for (const [type, records] of Object.entries(seed)) {
      for (const record of records) this.records.set(`${type}:${record.id || record.opportunityId || record.exportPackageId || record.paymentReceiptId || record.settlementRecordId}`, structuredClone(record));
    }
  }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async lifecycle(event) { this.lifecycleEvents.push(structuredClone(event)); return event; }
}

function extractedDocument(overrides = {}) {
  return {
    id: 'DOC-1',
    sha256: 'a'.repeat(64),
    documentType: 'PURCHASE_AGREEMENT',
    originalName: 'purchase-agreement.pdf',
    extraction: {
      status: 'EXTRACTED',
      extractedAt: '2026-09-01T00:00:00.000Z',
      model: 'test-extractor',
      facts: {
        documentType: 'PURCHASE_AGREEMENT',
        transactionType: 'VEHICLE_PURCHASE',
        identifiers: { agreementNumber: 'AGR-100' },
        parties: [
          { role: 'PURCHASER', legalName: 'Buyer LLC' },
          { role: 'DEALER', legalName: 'Dealer LLC' },
        ],
        asset: { type: 'VEHICLE', vin: 'VIN123', description: '2026 Vehicle' },
        economicTerms: { financedAmount: 50000, currency: 'USD' },
        dates: { agreementDate: '2026-08-31' },
        settlement: { payee: 'Dealer LLC', amount: 50000 },
        obligations: [],
        execution: {},
        sourceEvidence: [],
        ...overrides,
      },
    },
  };
}

test('transaction fact mapping automatically prepares neural underwriting and decision rationale', async () => {
  const domain = new Domain({
    FUNDING_OPPORTUNITY: [{
      id: 'OPP-1',
      opportunityId: 'OPP-1',
      financingStage: 'UNDERWRITING',
      requestedAmount: 50000,
      currency: 'USD',
      transactionFacts: [],
      transactionProfile: {},
      relatedAssetIds: [],
    }],
  });

  const result = await new TransactionFactsMappingService(domain).applyToOpportunity('OPP-1', extractedDocument(), 'USER-1');
  assert.equal(result.mapped, true);
  assert.equal(result.neuralUnderwriting.readyForAdminDecision, true);
  assert.equal(result.neuralUnderwriting.recommendedAmount, 50000);
  assert.match(result.neuralUnderwriting.conclusion, /administrator decision review/i);
  assert.match(result.neuralUnderwriting.decisionRationale, /Decision rationale prepared from recorded SRA evidence/i);

  const opportunity = domain.get('FUNDING_OPPORTUNITY', 'OPP-1');
  assert.equal(opportunity.neuralUnderwriting.agentId, 'SRA-UNDERWRITING-AGENT');
  assert.equal(opportunity.decisionPreparation.recommendation, 'READY_FOR_ADMIN_DECISION');
  assert.ok(opportunity.decisionPreparation.rationale);
  assert.ok(domain.lifecycleEvents.some((event) => event.eventType === 'FINANCING_NEURAL_REASONING_PREPARED'));
});

test('financing intelligence flags conflicting material evidence instead of silently resolving it', async () => {
  const firstFact = {
    documentType: 'PURCHASE_AGREEMENT',
    identifiers: { agreementNumber: 'AGR-100' },
    parties: [{ role: 'PURCHASER', legalName: 'Buyer LLC' }, { role: 'DEALER', legalName: 'Dealer LLC' }],
    asset: { vin: 'VIN123' },
    economicTerms: { financedAmount: 50000 },
    settlement: { payee: 'Dealer LLC', amount: 50000 },
    sourceDocument: { documentId: 'DOC-1', sha256: 'a'.repeat(64) },
  };
  const secondFact = {
    ...firstFact,
    economicTerms: { financedAmount: 49000 },
    settlement: { payee: 'Dealer LLC', amount: 49000 },
    sourceDocument: { documentId: 'DOC-2', sha256: 'b'.repeat(64) },
  };
  const domain = new Domain({
    FUNDING_OPPORTUNITY: [{
      id: 'OPP-2', opportunityId: 'OPP-2', financingStage: 'UNDERWRITING', requestedAmount: 50000,
      transactionFacts: [firstFact, secondFact], transactionProfile: { purchaserName: 'Buyer LLC', payeeName: 'Dealer LLC', vin: 'VIN123' },
    }],
  });

  const analysis = new FinancingIntelligenceService(domain).analyze('OPP-2');
  assert.equal(analysis.readyForAdminDecision, false);
  assert.equal(analysis.recommendation, 'REVIEW_EVIDENCE');
  assert.ok(analysis.conflicts.some((item) => item.field === 'TRANSACTION_AMOUNT'));
  assert.match(analysis.conclusion, /conflicting material facts/i);
});

test('external outcome reconciliation writes a structured settlement conclusion', async () => {
  const domain = new Domain({
    EXPORT_PACKAGE: [{
      id: 'EXP-1', exportPackageId: 'EXP-1', exportKind: 'FINANCING_DISBURSEMENT',
      financingTransactionId: 'FIN-1', instrumentId: 'INS-1', amount: 79456.17, currency: 'USD', beneficiaryName: 'Dealer LLC', state: 'READY_FOR_SETTLEMENT_INSTRUCTION',
    }],
    PAYMENT_RECEIPT: [{
      id: 'PAY-1', paymentReceiptId: 'PAY-1', financingTransactionId: 'FIN-1', status: 'SETTLED',
      settledAmount: 79456.17, beneficiaryName: 'Dealer LLC', settlementReference: 'COLL-100', settledAt: '2026-09-01T12:00:00.000Z',
    }],
    EXTERNAL_INTERACTION_EVENT: [{
      id: 'EXT-1', eventId: 'EXT-1', objectId: 'INS-1', transactionId: 'FIN-1', interactionType: 'INSTRUMENT_VERIFICATION_OPENED', channel: 'PUBLIC_VERIFICATION', actorType: 'EXTERNAL_ANONYMOUS', outcome: 'SUCCESS', occurredAt: '2026-09-01T10:00:00.000Z',
    }],
  });

  const service = new ExternalOutcomeReconciliationService(domain);
  const reconciled = await service.reconcile('EXP-1');
  assert.equal(reconciled.outcome.status, 'VERIFIED');
  assert.equal(reconciled.outcome.observed.externalInteractionCount, 1);
  assert.equal(reconciled.outcome.settlementConclusion.conclusionStatus, 'SETTLEMENT_COMPLETE');
  assert.equal(reconciled.outcome.settlementConclusion.settledAmount, 79456.17);
  assert.equal(reconciled.outcome.settlementConclusion.settlementReference, 'COLL-100');
  assert.equal(reconciled.outcome.settlementConclusion.nextLifecycleAction, 'PREPARE_SERVICING_HANDOFF');
  assert.match(reconciled.outcome.settlementConclusion.narrative, /reconciled and ready for the servicing handoff/i);

  const summary = service.summary('EXP-1');
  assert.equal(summary.verified, true);
  assert.equal(summary.attentionRequired, false);
});

test('settlement conclusion detects amount mismatch and refuses a complete conclusion', async () => {
  const domain = new Domain({
    EXPORT_PACKAGE: [{
      id: 'EXP-2', exportPackageId: 'EXP-2', financingTransactionId: 'FIN-2', amount: 1000, currency: 'USD', beneficiaryName: 'Dealer LLC', state: 'READY_FOR_SETTLEMENT_INSTRUCTION',
    }],
    SRA_SETTLEMENT_RECORD: [{
      id: 'SET-2', settlementRecordId: 'SET-2', financingTransactionId: 'FIN-2', status: 'SETTLED', settledAmount: 900, beneficiaryName: 'Dealer LLC', externalReference: 'REF-2',
    }],
  });

  const service = new ExternalOutcomeReconciliationService(domain);
  const reconciled = await service.reconcile('EXP-2');
  assert.equal(reconciled.outcome.status, 'VERIFIED');
  assert.equal(reconciled.outcome.settlementConclusion.conclusionStatus, 'EXCEPTION');
  assert.equal(reconciled.outcome.settlementConclusion.amountMatches, false);
  assert.equal(service.summary('EXP-2').verified, false);
  assert.equal(service.summary('EXP-2').attentionRequired, true);
});
