import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ContextInstructionReasoningService } from '../services/context-instruction-reasoning-service.js';
import { UnifiedMarketOperationsQueueService } from '../services/unified-market-operations-queue-service.js';

class Domain {
  constructor(records = {}) {
    this.records = new Map(Object.entries(records));
    this.hydrated = [];
  }
  get(type, id) {
    return (this.records.get(type) || []).find((record) => [record.id, record.exportPackageId, record.opportunityId, record.closingId, record.participantId, record.assetId].includes(id)) || null;
  }
  list(type) { return this.records.get(type) || []; }
  async hydrate(types) { this.hydrated.push(...types); return {}; }
  async put(type, id, record) {
    const list = this.records.get(type) || [];
    const next = list.filter((item) => item.id !== id);
    next.push(record);
    this.records.set(type, next);
    return record;
  }
}

test('dealer reasoning detects vehicle data from linked asset metadata', () => {
  const domain = new Domain({
    EXPORT_PACKAGE: [{
      id: 'EXP-1', exportPackageId: 'EXP-1', exportKind: 'FINANCING_DISBURSEMENT',
      financingTransactionId: 'FT-1', opportunityId: 'FOR-1', closingId: 'FCL-1',
      beneficiaryName: 'Example Dealer', amount: 50000, currency: 'USD',
    }],
    FINANCING_CLOSING: [{ id: 'FCL-1', closingId: 'FCL-1', beneficiaryName: 'Example Dealer' }],
    FUNDING_OPPORTUNITY: [{
      id: 'FOR-1', opportunityId: 'FOR-1', relatedAssetIds: ['ASSET-1'], transactionProfile: {},
    }],
    ASSET_ACCOUNT: [{ id: 'ASSET-1', assetId: 'ASSET-1', metadata: { vin: 'VIN-123', year: '2026', make: 'Audi', model: 'Q5' } }],
    OPERATIONAL_EVENT: [], OPERATIONAL_MEMORY: [], AGENT_DECISION: [], ACTION_PLAN: [], ACTION_RESULT: [], OUTCOME_EVALUATION: [],
  });
  const reasoning = new ContextInstructionReasoningService(domain).reasonForExportPackage('EXP-1');
  assert.equal(reasoning.recipientType, 'DEALER');
  assert.ok(reasoning.requiredDocuments.includes('DEALER_PROCESSING_INSTRUCTIONS'));
});

test('persisted operations build hydrates all intelligence record types before reasoning', async () => {
  const domain = new Domain({ SRA_TRANSACTION: [], EXPORT_PACKAGE: [], COIN_POSITION: [] });
  const queue = new UnifiedMarketOperationsQueueService(domain);
  await queue.explainPersisted();
  assert.deepEqual(new Set(domain.hydrated), new Set([
    'OPERATIONAL_EVENT', 'OPERATIONAL_MEMORY', 'AGENT_DECISION',
    'ACTION_PLAN', 'ACTION_RESULT', 'OUTCOME_EVALUATION',
  ]));
});

test('SANE operations queue uses the persisted reasoning path', () => {
  const source = fs.readFileSync(new URL('../routes/sane-router.js', import.meta.url), 'utf8');
  assert.match(source, /router\.get\('\/operations-queue',[\s\S]*await unifiedOperationsQueue\.explainPersisted\(\)/);
});
