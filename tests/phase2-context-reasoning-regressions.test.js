import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ContextInstructionReasoningService } from '../services/context-instruction-reasoning-service.js';
import { UnifiedMarketOperationsQueueService } from '../services/unified-market-operations-queue-service.js';

class Domain {
  constructor(records = {}) {
    this.records = new Map(Object.entries(records));
    this.hydrated = [];
    this.hydrateCalls = 0;
  }
  get(type, id) {
    return (this.records.get(type) || []).find((record) => [record.id, record.exportPackageId, record.opportunityId, record.closingId, record.participantId, record.assetId].includes(id)) || null;
  }
  list(type) { return this.records.get(type) || []; }
  async hydrate(types) {
    this.hydrateCalls += 1;
    this.hydrated.push(...types);
    return {};
  }
  async put(type, id, record) {
    const list = this.records.get(type) || [];
    const next = list.filter((item) => item.id !== id);
    next.push(record);
    this.records.set(type, next);
    return record;
  }
}

function baseRecords(asset, opportunityOverrides = {}) {
  return {
    EXPORT_PACKAGE: [{
      id: 'EXP-1', exportPackageId: 'EXP-1', exportKind: 'FINANCING_DISBURSEMENT',
      financingTransactionId: 'FT-1', opportunityId: 'FOR-1', closingId: 'FCL-1',
      beneficiaryName: 'External Recipient', amount: 50000, currency: 'USD',
    }],
    FINANCING_CLOSING: [{ id: 'FCL-1', closingId: 'FCL-1', beneficiaryName: 'External Recipient' }],
    FUNDING_OPPORTUNITY: [{
      id: 'FOR-1', opportunityId: 'FOR-1', relatedAssetIds: ['ASSET-1'], transactionProfile: {},
      ...opportunityOverrides,
    }],
    ASSET_ACCOUNT: [asset],
    OPERATIONAL_EVENT: [], OPERATIONAL_MEMORY: [], AGENT_DECISION: [], ACTION_PLAN: [], ACTION_RESULT: [], OUTCOME_EVALUATION: [],
  };
}

test('dealer reasoning detects vehicle data from linked asset metadata', () => {
  const domain = new Domain(baseRecords({
    id: 'ASSET-1', assetId: 'ASSET-1', classification: 'MOTOR_VEHICLE',
    metadata: { vin: 'VIN-123', year: '2026', make: 'Audi', model: 'Q5' },
  }));
  const reasoning = new ContextInstructionReasoningService(domain).reasonForExportPackage('EXP-1');
  assert.equal(reasoning.recipientType, 'DEALER');
  assert.ok(reasoning.requiredDocuments.includes('DEALER_PROCESSING_INSTRUCTIONS'));
});

test('explicit vehicle profile fields trigger dealer instructions without VIN or classification', () => {
  const records = baseRecords({
    id: 'ASSET-1', assetId: 'ASSET-1', classification: 'EQUIPMENT', metadata: {},
  });
  records.FUNDING_OPPORTUNITY[0].transactionProfile = {
    vehicleYear: '2026', vehicleMake: 'Audi', vehicleModel: 'Q5',
  };
  const reasoning = new ContextInstructionReasoningService(new Domain(records)).reasonForExportPackage('EXP-1');
  assert.equal(reasoning.recipientType, 'DEALER');
  assert.ok(reasoning.requiredDocuments.includes('DEALER_PROCESSING_INSTRUCTIONS'));
});

test('explicit opportunity vehicle fields trigger dealer instructions without VIN or classification', () => {
  const domain = new Domain(baseRecords(
    { id: 'ASSET-1', assetId: 'ASSET-1', classification: 'EQUIPMENT', metadata: {} },
    { vehicleYear: '2026', vehicleMake: 'Audi', vehicleModel: 'Q5' },
  ));
  const reasoning = new ContextInstructionReasoningService(domain).reasonForExportPackage('EXP-1');
  assert.equal(reasoning.recipientType, 'DEALER');
  assert.ok(reasoning.requiredDocuments.includes('DEALER_PROCESSING_INSTRUCTIONS'));
});

test('generic year make and model do not turn a non-vehicle asset into dealer financing', () => {
  const domain = new Domain(baseRecords({
    id: 'ASSET-1', assetId: 'ASSET-1', classification: 'REAL_ESTATE',
    metadata: { year: '1998', make: 'Commercial', model: 'Warehouse' },
  }));
  const reasoning = new ContextInstructionReasoningService(domain).reasonForExportPackage('EXP-1');
  assert.notEqual(reasoning.recipientType, 'DEALER');
  assert.ok(!reasoning.requiredDocuments.includes('DEALER_PROCESSING_INSTRUCTIONS'));
});

test('AUTO substrings in non-vehicle classifications do not trigger dealer financing', () => {
  for (const classification of ['AUTOMATION_EQUIPMENT', 'AUTOMOBILE_PARTS']) {
    const domain = new Domain(baseRecords({
      id: 'ASSET-1', assetId: 'ASSET-1', classification,
      metadata: { year: '2024', make: 'Industrial', model: 'Series A' },
    }));
    const reasoning = new ContextInstructionReasoningService(domain).reasonForExportPackage('EXP-1');
    assert.notEqual(reasoning.recipientType, 'DEALER');
    assert.ok(!reasoning.requiredDocuments.includes('DEALER_PROCESSING_INSTRUCTIONS'));
  }
});

test('persisted operations build hydrates intelligence once per queue service', async () => {
  const domain = new Domain({ SRA_TRANSACTION: [], EXPORT_PACKAGE: [], COIN_POSITION: [] });
  const queue = new UnifiedMarketOperationsQueueService(domain);
  await queue.explainPersisted();
  await queue.explainPersisted();
  assert.equal(domain.hydrateCalls, 1);
  assert.deepEqual(new Set(domain.hydrated), new Set([
    'OPERATIONAL_EVENT', 'OPERATIONAL_MEMORY', 'AGENT_DECISION',
    'ACTION_PLAN', 'ACTION_RESULT', 'OUTCOME_EVALUATION',
  ]));
});

test('SANE operations queue uses persisted reasoning and catches async failures', () => {
  const source = fs.readFileSync(new URL('../routes/sane-router.js', import.meta.url), 'utf8');
  assert.match(source, /router\.get\('\/operations-queue',[\s\S]*await unifiedOperationsQueue\.explainPersisted\(\)/);
  assert.match(source, /router\.get\('\/operations-queue',[\s\S]*catch \(error\)[\s\S]*SRA_OPERATIONS_QUEUE_FAILED/);
});
