import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminIntelligenceAgentService } from '../services/admin-intelligence-agent-service.js';

class MemoryDomain {
  constructor(records = {}) { this.records = records; }
  list(type) { return structuredClone(this.records[type] || []); }
  snapshot() { return { counts: Object.fromEntries(Object.entries(this.records).map(([type, records]) => [type, records.length])) }; }
}

function trueBillRecords() {
  return {
    SRA_PRODUCT_DEFINITION: [],
    SRA_INSTRUMENT: [{ instrumentId: 'INS-TB-1', instrumentFamily: 'TRUE_BILL', state: 'ISSUED' }],
    MARKETPLACE_LISTING: [{ listingId: 'LIST-1', instrumentId: 'INS-TB-1', state: 'PUBLISHED' }],
    PARTICIPATION_POSITION: [],
    FUNDING_MARKETPLACE_COMMITMENT: [],
    FUNDING_MARKETPLACE_POSITION: [],
    SRA_SETTLEMENT_RECORD: [],
    OWNERSHIP_RECOGNITION: [],
    EXPORT_PACKAGE: [],
  };
}

test('agent answers product lifecycle questions from stored SRA records', async () => {
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(trueBillRecords()) });
  const response = await agent.ask({ question: 'Where is my first True Bill right now?' }, { id: 'ADMIN-1', displayName: 'Owner' });
  assert.equal(response.intent, 'PRODUCT_LIFECYCLE');
  assert.equal(response.productCode, 'TRUE_BILL');
  assert.equal(response.status, 'IN_PROGRESS');
  assert.match(response.answer, /participation/i);
  assert.equal(response.nextAction.authority, 'SRA_AGENT_AUTONOMOUS');
  assert.equal(response.references.some((item) => item.recordId === 'INS-TB-1'), true);
});

test('agent identifies protected human approval boundaries', async () => {
  const records = trueBillRecords();
  records.PARTICIPATION_POSITION.push({ positionId: 'PART-1', instrumentId: 'INS-TB-1', listingId: 'LIST-1', participantId: 'USER-1', state: 'ACTIVE' });
  records.FUNDING_MARKETPLACE_COMMITMENT.push({ commitmentId: 'COM-1', instrumentId: 'INS-TB-1', listingId: 'LIST-1', participantId: 'USER-1', state: 'COMMITTED' });
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(records) });
  const response = await agent.ask({ question: 'What is blocking the True Bill and what happens next?' }, { id: 'ADMIN-1' });
  assert.equal(response.nextAction.stage, 'allocation');
  assert.equal(response.nextAction.authority, 'ADMIN_APPROVAL_REQUIRED');
  assert.equal(response.nextAction.autonomous, false);
});

test('agent reports when a product lifecycle has not started', async () => {
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain({}) });
  const response = await agent.ask({ question: 'Where is the commercial paper?' }, { id: 'ADMIN-1' });
  assert.equal(response.productCode, 'COMMERCIAL_PAPER');
  assert.equal(response.status, 'NOT_STARTED');
  assert.deepEqual(response.blockers, ['NO_INSTRUMENT']);
  assert.equal(response.nextAction.authority, 'ADMIN_APPROVAL_REQUIRED');
});

test('agent discovers a registered product by its human name and uses its instrument families', async () => {
  const records = trueBillRecords();
  records.SRA_PRODUCT_DEFINITION.push({
    productDefinitionId: 'CUSTOM-BILL',
    productCode: 'CUSTOM_BILL',
    name: 'Community Funding Bill',
    instrumentFamilies: ['TRUE_BILL'],
    state: 'ACTIVE',
  });
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(records) });
  const response = await agent.ask({ question: 'Where is the Community Funding Bill right now?' }, { id: 'ADMIN-1' });
  assert.equal(response.productCode, 'CUSTOM_BILL');
  assert.equal(response.data.instrumentCount, 1);
  assert.deepEqual(response.data.instrumentFamilies, ['TRUE_BILL']);
  assert.match(response.answer, /CUSTOM_BILL/);
});

test('agent includes registered custom products in approval discovery', async () => {
  const records = trueBillRecords();
  records.SRA_PRODUCT_DEFINITION.push({
    productDefinitionId: 'CUSTOM-BILL',
    productCode: 'CUSTOM_BILL',
    name: 'Community Funding Bill',
    instrumentFamilies: ['TRUE_BILL'],
    state: 'ACTIVE',
  });
  records.PARTICIPATION_POSITION.push({ positionId: 'PART-1', instrumentId: 'INS-TB-1', listingId: 'LIST-1', participantId: 'USER-1', state: 'ACTIVE' });
  records.FUNDING_MARKETPLACE_COMMITMENT.push({ commitmentId: 'COM-1', instrumentId: 'INS-TB-1', listingId: 'LIST-1', participantId: 'USER-1', state: 'COMMITTED' });
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(records) });
  const response = await agent.ask({ question: 'What needs my approval?' }, { id: 'ADMIN-1' });
  assert.equal(response.status, 'APPROVAL_REQUIRED');
  assert.equal(response.pendingActions.some((item) => item.productCode === 'CUSTOM_BILL' && item.stage === 'allocation'), true);
});

test('agent answers platform summary and capability questions', async () => {
  const records = trueBillRecords();
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(records) });
  const summary = await agent.ask({ question: 'How is the platform doing?' }, { id: 'ADMIN-1' });
  assert.equal(summary.intent, 'PLATFORM_SUMMARY');
  assert.match(summary.answer, /1 instruments/);
  const capabilities = await agent.ask({ question: 'What can you do?' }, { id: 'ADMIN-1' });
  assert.equal(capabilities.intent, 'CAPABILITIES');
  assert.equal(capabilities.capabilities.mode, 'AUTONOMOUS_READ_AND_REASON');
  assert.equal(capabilities.capabilities.writeAuthority, 'HUMAN_IN_THE_LOOP');
  assert.equal(capabilities.capabilities.can.includes('DISCOVER_REGISTERED_PRODUCTS'), true);
});

test('agent audits each authenticated answer', async () => {
  const events = [];
  const database = { audit: async (event) => events.push(event) };
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(trueBillRecords()), database });
  await agent.ask({ question: 'Where is the True Bill?' }, { id: 'ADMIN-1' });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'ADMIN_AGENT_QUESTION_ANSWERED');
  assert.equal(events[0].actorId, 'ADMIN-1');
});
