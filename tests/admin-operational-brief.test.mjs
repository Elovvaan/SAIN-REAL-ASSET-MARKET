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

test('diagnoses persistent record state, server errors, and slow routes', async () => {
  const database = {
    summarizeRecords: async (types) => ({
      generatedAt: '2026-09-21T12:00:00.000Z',
      counts: Object.fromEntries(types.map((type) => [type, type === 'SRA_INSTRUMENT' ? 5848 : type === 'COIN_POSITION' ? 473 : 0])),
      states: Object.fromEntries(types.map((type) => [type, type === 'SRA_INSTRUMENT' ? { ISSUED:5847, REVIEW_REQUIRED:1 } : {}])),
      samples: Object.fromEntries(types.map((type) => [type, []])),
    }),
    audit: async () => {},
  };
  const runtimeMetricsProvider = () => ({ byRoute:{ '/api/admin/instruments':{ requests:4, errors:1, averageDurationMs:2200, maxDurationMs:6100 } }, recentErrors:[{ path:'/api/admin/instruments', status:502 }] });
  const result = await new AdminIntelligenceAgentService({ domain:new MemoryDomain(), database, runtimeMetricsProvider }).ask({ question:'Diagnose the platform and tell me what is sticking.' });
  assert.equal(result.intent, 'DIAGNOSTICS');
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.diagnostics.counts.SRA_INSTRUMENT, 5848);
  assert.equal(result.diagnostics.findings.some((item) => item.state === 'REVIEW_REQUIRED'), true);
  assert.equal(result.diagnostics.findings.some((item) => item.route === '/api/admin/instruments' && item.state === 'HTTP_ERRORS'), true);
  assert.equal(result.diagnostics.slowRoutes[0].maxDurationMs, 6100);
});

test('uses live platform context for open administrative conversation', async () => {
  let suppliedContext = null;
  const database = { summarizeRecords: async (types) => ({ generatedAt:new Date().toISOString(), counts:Object.fromEntries(types.map((type)=>[type,type === 'COIN_POSITION'?12:0])), states:Object.fromEntries(types.map((type)=>[type,{}])), samples:Object.fromEntries(types.map((type)=>[type,[]])) }), audit:async()=>{} };
  const conversationalAgent = { available:()=>true, chat:async(input)=>{ suppliedContext=input.context; return{ message:'The Coin Positions are present, and I am checking their next lifecycle stage.' }; } };
  const result = await new AdminIntelligenceAgentService({ domain:new MemoryDomain(), database, conversationalAgent }).ask({ question:'Talk me through what you see happening right now.' });
  assert.equal(result.intent, 'OPEN_CONVERSATION');
  assert.equal(result.status, 'AVAILABLE');
  assert.match(result.answer, /Coin Positions are present/);
  assert.equal(suppliedContext.liveRecords.counts.COIN_POSITION, 12);
});
