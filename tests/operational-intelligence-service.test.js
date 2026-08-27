import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationalIntelligenceService } from '../services/operational-intelligence-service.js';

class MemoryDomain {
  constructor() { this.store = new Map(); }
  create(type, record) {
    if (!this.store.has(type)) this.store.set(type, []);
    this.store.get(type).push(record);
    return record;
  }
  list(type) { return this.store.get(type) || []; }
}

test('Phase 1 records an operational loop without inventing an external outcome', () => {
  const domain = new MemoryDomain();
  const intelligence = new OperationalIntelligenceService(domain);
  const transactionId = 'FT-TEST-001';

  const event = intelligence.observe({
    eventType: 'FUNDING_PACKAGE_GENERATED',
    financingTransactionId: transactionId,
    exportPackageId: 'EP-001',
    stateBefore: 'APPROVED',
    stateAfter: 'PACKAGE_GENERATED',
  });

  intelligence.remember({
    subjectType: 'FINANCING_TRANSACTION',
    subjectId: transactionId,
    transactionId,
    sourceEventId: event.eventId,
    summary: 'Funding package generated.',
  });

  const decision = intelligence.recordDecision({
    agentId: 'EXPORT_AGENT',
    decision: 'PRESENT_PACKAGE',
    reason: 'Package generation completed from recorded transaction state.',
    transactionId,
    sourceEventIds: [event.eventId],
  });

  const plan = intelligence.createPlan({
    goal: 'Present funding package and await recipient processing result.',
    transactionId,
    createdByAgentId: 'EXPORT_AGENT',
    sourceDecisionId: decision.decisionId,
    steps: [{ id: 'PRESENT', status: 'READY' }, { id: 'VERIFY_EXTERNAL_OUTCOME', status: 'WAITING' }],
  });

  intelligence.recordResult({
    action: 'PACKAGE_GENERATED',
    planId: plan.planId,
    transactionId,
    status: 'COMPLETED',
    data: { exportPackageId: 'EP-001' },
  });

  const context = intelligence.contextFor(transactionId);
  assert.equal(context.events.length, 1);
  assert.equal(context.memories.length, 1);
  assert.equal(context.decisions.length, 1);
  assert.equal(context.plans.length, 1);
  assert.equal(context.results.length, 1);
  assert.equal(context.outcomes.length, 0);
});

test('Phase 1 stores verified outcomes separately from actions', () => {
  const domain = new MemoryDomain();
  const intelligence = new OperationalIntelligenceService(domain);
  const transactionId = 'FT-TEST-002';

  const result = intelligence.recordResult({
    action: 'PACKAGE_PRESENTED',
    transactionId,
    status: 'COMPLETED',
    externalReference: 'recipient-message-1',
  });

  intelligence.evaluateOutcome({
    target: 'RECIPIENT_PROCESSING',
    status: 'ADDITIONAL_INFORMATION_REQUIRED',
    transactionId,
    resultId: result.resultId,
    observed: 'Recipient requested additional processing information.',
    evidence: ['recipient-message-1'],
  });

  const context = intelligence.contextFor(transactionId);
  assert.equal(context.results[0].status, 'COMPLETED');
  assert.equal(context.outcomes[0].status, 'ADDITIONAL_INFORMATION_REQUIRED');
});
