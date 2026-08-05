import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminIntelligenceAgentService } from '../services/admin-intelligence-agent-service.js';

class MemoryDomain {
  constructor(records = {}) { this.records = records; }
  list(type) { return structuredClone(this.records[type] || []); }
  snapshot() { return { counts: Object.fromEntries(Object.entries(this.records).map(([type, records]) => [type, records.length])) }; }
}

test('platform summary uses the same direct record counts shown by administration metrics', async () => {
  const records = {
    MARKET_OBSERVATION: Array.from({ length: 398 }, (_, index) => ({ observationId: `OBS-${index}` })),
    RECOGNITION_ASSESSMENT: Array.from({ length: 398 }, (_, index) => ({ recognitionId: `REC-${index}` })),
    FINANCIAL_RECORD: Array.from({ length: 398 }, (_, index) => ({ financialRecordId: `FR-${index}` })),
    COIN_POSITION: Array.from({ length: 398 }, (_, index) => ({ coinPositionId: `CP-${index}` })),
    SRA_INSTRUMENT: Array.from({ length: 398 }, (_, index) => ({ instrumentId: `INS-${index}` })),
    MARKETPLACE_LISTING: [{ listingId: 'LIST-1' }],
    PARTICIPATION_POSITION: [],
    FUNDING_MARKETPLACE_COMMITMENT: [],
    FUNDING_MARKETPLACE_POSITION: [],
    SRA_SETTLEMENT_RECORD: [],
    OWNERSHIP_RECOGNITION: [],
    EXPORT_PACKAGE: [],
    SRA_PRODUCT_DEFINITION: [],
  };
  const agent = new AdminIntelligenceAgentService({ domain: new MemoryDomain(records) });
  const response = await agent.ask({ question: 'How is the platform doing?' }, { id: 'ADMIN-1' });

  assert.equal(response.counts.MARKET_OBSERVATION, 398);
  assert.equal(response.counts.RECOGNITION_ASSESSMENT, 398);
  assert.equal(response.counts.FINANCIAL_RECORD, 398);
  assert.equal(response.counts.COIN_POSITION, 398);
  assert.equal(response.counts.SRA_INSTRUMENT, 398);
  assert.equal(response.counts.MARKETPLACE_LISTING, 1);
  assert.equal(response.lifecycleTotal, 1991);
  assert.equal(response.countMeaning, 'SUM_OF_STAGE_RECORDS_NOT_UNIQUE_ASSETS');
  assert.match(response.answer, /Live SRA snapshot as of/);
  assert.match(response.answer, /398 instruments/);
  assert.match(response.answer, /sum across lifecycle stages, not a count of unique assets/i);
  assert.ok(Date.parse(response.snapshotAt));
});
