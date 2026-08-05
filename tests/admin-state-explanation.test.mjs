import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminIntelligenceAgentService } from '../services/admin-intelligence-agent-service.js';

class MemoryDomain {
  constructor(records = {}) { this.records = records; }
  list(type) { return structuredClone(this.records[type] || []); }
  snapshot() { return { counts: Object.fromEntries(Object.entries(this.records).map(([type, records]) => [type, records.length])) }; }
}

function recordsAtApprovalBoundary() {
  return {
    SRA_PRODUCT_DEFINITION: [{ productDefinitionId: 'TRUE_BILL', productCode: 'TRUE_BILL', name: 'True Bill', instrumentFamilies: ['TRUE_BILL'], state: 'ACTIVE' }],
    SRA_INSTRUMENT: [{ instrumentId: 'INS-3B35DF77', instrumentFamily: 'TRUE_BILL', financialRecordId: 'FR-1', recognitionAssessmentId: 'RA-1', issuerId: 'ISSUER-1', state: 'ISSUED' }],
    MARKETPLACE_LISTING: [{ listingId: 'LIST-1', instrumentId: 'INS-3B35DF77', state: 'PUBLISHED' }],
    PARTICIPATION_POSITION: [{ positionId: 'PART-1', instrumentId: 'INS-3B35DF77', listingId: 'LIST-1', participantId: 'USER-1', state: 'ACTIVE' }],
    FUNDING_MARKETPLACE_COMMITMENT: [{ commitmentId: 'COM-1', instrumentId: 'INS-3B35DF77', listingId: 'LIST-1', participantId: 'USER-1', state: 'COMMITTED' }],
    FUNDING_MARKETPLACE_POSITION: [],
    SRA_SETTLEMENT_RECORD: [],
    OWNERSHIP_RECOGNITION: [],
    EXPORT_PACKAGE: [],
  };
}

test('explains exact exportability blockers from the SRA lifecycle', async () => {
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(recordsAtApprovalBoundary()) });
  const response = await agent.ask({ question: 'Why is instrument INS-3B35DF77 not exportable?' }, { id: 'ADMIN-1' });
  assert.equal(response.intent, 'ASSET_EXPORTABILITY');
  assert.equal(response.status, 'BLOCKED');
  assert.equal(response.subject.reference, 'INS-3B35DF77');
  assert.equal(response.blockers.some((item) => item.code === 'MISSING_ALLOCATION'), true);
  assert.equal(response.blockers.some((item) => item.code === 'ADMIN_APPROVAL_REQUIRED'), true);
  assert.equal(response.simulation, null);
});

test('returns the full instrument lifecycle with record evidence', async () => {
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(recordsAtApprovalBoundary()) });
  const response = await agent.ask({ question: 'Show me the lifecycle of instrument INS-3B35DF77.' }, { id: 'ADMIN-1' });
  assert.equal(response.intent, 'ASSET_LIFECYCLE');
  assert.equal(response.lifecycle.length, 8);
  assert.equal(response.lifecycle.find((item) => item.stage === 'instrument').recordId, 'INS-3B35DF77');
  assert.equal(response.lifecycle.find((item) => item.stage === 'allocation').state, 'NOT_RECORDED');
});

test('traces instrument relationships to supporting and downstream records', async () => {
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(recordsAtApprovalBoundary()) });
  const response = await agent.ask({ question: 'What relationships are connected to asset INS-3B35DF77?' }, { id: 'ADMIN-1' });
  assert.equal(response.intent, 'ASSET_RELATIONSHIPS');
  assert.equal(response.relationships.some((item) => item.relationship === 'RECOGNIZED_FROM' && item.targetReference === 'FR-1'), true);
  assert.equal(response.relationships.some((item) => item.relationship === 'HAS_LISTING' && item.targetReference === 'LIST-1'), true);
});

test('lists inferred protected actions waiting at the administrator boundary', async () => {
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(recordsAtApprovalBoundary()) });
  const response = await agent.ask({ question: 'What approval is waiting on me?' }, { id: 'ADMIN-1' });
  assert.equal(response.intent, 'PENDING_APPROVALS');
  assert.equal(response.status, 'APPROVAL_REQUIRED');
  assert.equal(response.pendingActions[0].approvalId, 'APR-INS-3B35DF77-ALLOCATION');
  assert.equal(response.pendingActions[0].requiredAuthority, 'PLATFORM_ADMIN');
});

test('simulates approval impact without writing or creating a downstream record', async () => {
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(recordsAtApprovalBoundary()) });
  const response = await agent.ask({ question: 'What would happen if I approved this? Approval ID: APR-INS-3B35DF77-ALLOCATION' }, { id: 'ADMIN-1' });
  assert.equal(response.intent, 'APPROVAL_IMPACT');
  assert.equal(response.status, 'READ_ONLY_SIMULATION');
  assert.equal(response.simulation.readOnly, true);
  assert.equal(response.simulation.proposedDecision, 'APPROVED');
  assert.equal(response.simulation.predictedChanges.some((item) => item.field === 'authorizedNextStage' && item.to === 'allocation'), true);
  assert.equal(response.simulation.unchangedUntilSeparateExecution.includes('Allocation position'), true);
});

test('advertises the new explanation and simulation capabilities', () => {
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(recordsAtApprovalBoundary()) });
  const capabilities = agent.capabilities();
  assert.equal(capabilities.can.includes('EXPLAIN_ASSET_EXPORTABILITY'), true);
  assert.equal(capabilities.can.includes('TRACE_ASSET_RELATIONSHIPS'), true);
  assert.equal(capabilities.can.includes('SIMULATE_APPROVAL_IMPACT_READ_ONLY'), true);
  assert.equal(capabilities.writeAuthority, 'HUMAN_IN_THE_LOOP');
});
