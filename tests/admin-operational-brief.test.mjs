import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminIntelligenceAgentService } from '../services/admin-intelligence-agent-service.js';

class MemoryDomain {
  constructor(records = {}) { this.records = records; }
  list(type) { return this.records[type] || []; }
}

test('answers incomplete workflow questions with an operational brief', async () => {
  const domain = new MemoryDomain({
    SRA_INSTRUMENT: [{ instrumentId: 'INS-TEST-1', instrumentFamily: 'TRUE_BILL', state: 'ISSUED' }],
    SRA_PRODUCT_DEFINITION: [{ productCode: 'TRUE_BILL', state: 'ACTIVE' }],
  });
  const result = await new AdminIntelligenceAgentService({ domain }).ask({ question: 'Show incomplete workflows and the next action for each.' });
  assert.equal(result.intent, 'OPERATIONAL_BRIEF');
  assert.equal(result.status, 'ATTENTION_REQUIRED');
  assert.equal(result.nextAction?.stage, 'listing');
  assert.equal(result.nextAction?.authority, 'ADMIN_APPROVAL_REQUIRED');
});

test('uses platform snapshot counts in the operational brief', () => {
  const domain = new MemoryDomain({ MARKET_OBSERVATION: [{}, {}], RECOGNITION_ASSESSMENT: [{}], FINANCIAL_RECORD: [{}], COIN_POSITION: [{}] });
  const brief = new AdminIntelligenceAgentService({ domain }).operationalBrief();
  assert.equal(brief.counts.MARKET_OBSERVATION, 2);
  assert.equal(brief.counts.RECOGNITION_ASSESSMENT, 1);
  assert.equal(brief.counts.FINANCIAL_RECORD, 1);
  assert.equal(brief.counts.COIN_POSITION, 1);
});

test('preserves the human approval boundary', () => {
  const capabilities = new AdminIntelligenceAgentService({ domain: new MemoryDomain() }).capabilities();
  assert.ok(capabilities.can.includes('GENERATE_OPERATIONAL_BRIEF'));
  assert.equal(capabilities.writeAuthority, 'HUMAN_IN_THE_LOOP');
  assert.ok(capabilities.cannotWithoutApproval.includes('PUBLISH_LISTING'));
});
