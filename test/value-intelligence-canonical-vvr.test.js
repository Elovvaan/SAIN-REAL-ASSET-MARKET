import test from 'node:test';
import assert from 'node:assert/strict';
import { ValueIntelligenceService } from '../services/value-intelligence-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';
import { DETERMINATION_RECORD_TYPES } from '../services/determination-engine-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.lifecycleEvents = []; }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() { return {}; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async seed(type, records = []) {
    if (this.list(type).length) return this.list(type);
    for (const record of records) await this.put(type, record.assetId || record.id, record);
    return this.list(type);
  }
  async atomicPut(changes = []) {
    for (const change of changes) await this.put(change.type, change.id, change.payload);
    return changes.map((change) => structuredClone(change.payload));
  }
  async lifecycle(input) { this.lifecycleEvents.push(structuredClone(input)); return input; }
}

const marketplace = {
  assets: [{ id: 'A-1', state: 'ACTIVE', verifiedValue: 100, verifiedCycles: 3, lifecycleEvents: 4 }],
  projects: [{ id: 'P-1', assetId: 'A-1', projectedCompletedValue: 125, projectedGain: 25, projectedGainRate: 25 }],
};

test('verified market events emit an immutable canonical VVR chain while preserving the legacy projection', async () => {
  const domain = new MemoryDomain();
  const service = new ValueIntelligenceService(marketplace, domain);
  await service.initialize();

  const signal = domain.list(RECORD_TYPES.MARKET_SIGNAL)[0];
  const result = await service.verifyMarketEvent({
    signalId: signal.signalId,
    eventType: 'SALE_CLOSED',
    realizedAmount: 112.5,
    currency: 'USD',
    occurredAt: '2026-08-07T14:00:00.000Z',
    evidenceReference: 'EVIDENCE-SALE-1',
  }, 'ADMIN-1');

  assert.equal(result.verifiedValueRecord.verifiedValue, 112.5);
  assert.equal(result.verifiedValueRecord.canonicalValueArchitecture, 'REFERENCE_TO_IMMUTABLE_VVR');
  assert.equal(result.verifiedValueRecord.canonicalVerifiedValueRecordId, result.canonicalVerifiedValueRecord.verifiedValueRecordId);
  assert.equal(result.event.canonicalVerifiedValueRecordId, result.canonicalVerifiedValueRecord.verifiedValueRecordId);
  assert.equal(result.event.determinationSubjectId, 'MARKET-EVENT-ASSET-A-1');
  assert.equal(result.canonicalVerifiedValueRecord.value, 112.5);
  assert.equal(result.canonicalVerifiedValueRecord.state, 'CANONICAL');
  assert.equal(result.canonicalVerifiedValueRecord.immutable, true);
  assert.equal(result.canonicalVerifiedValueRecord.confidence.level, 'DIRECT_VERIFIED_EVENT');
  assert.equal(result.canonicalVerifiedValueRecord.contractFormationBoundary.referenceOnly, true);
  assert.equal(result.canonicalVerifiedValueRecord.contractFormationBoundary.createsInstrument, false);

  const subjects = domain.list(DETERMINATION_RECORD_TYPES.SUBJECT);
  const snapshots = domain.list(DETERMINATION_RECORD_TYPES.SNAPSHOT);
  const determinations = domain.list(DETERMINATION_RECORD_TYPES.DETERMINATION);
  const canonicalRecords = domain.list(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE);
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].subjectId, 'MARKET-EVENT-ASSET-A-1');
  assert.equal(snapshots.length, 1);
  assert.equal(determinations.length, 1);
  assert.equal(canonicalRecords.length, 1);
  assert.equal(snapshots[0].immutable, true);
  assert.equal(determinations[0].methodology, 'DIRECT');
});

test('asset state returns the canonical VVR referenced by the legacy verified value record', async () => {
  const domain = new MemoryDomain();
  const service = new ValueIntelligenceService(marketplace, domain);
  await service.initialize();
  const signal = domain.list(RECORD_TYPES.MARKET_SIGNAL)[0];
  await service.verifyMarketEvent({ signalId: signal.signalId, eventType: 'PAYMENT_RECEIVED', realizedAmount: 105 }, 'ADMIN-1');

  const state = service.listAssetState('A-1');
  assert.equal(state.verifiedValue.verifiedValue, 105);
  assert.ok(state.verifiedValue.canonicalVerifiedValueRecordId);
  assert.equal(state.canonicalVerifiedValueRecord.verifiedValueRecordId, state.verifiedValue.canonicalVerifiedValueRecordId);
  assert.equal(state.canonicalVerifiedValueRecord.value, 105);
});

test('subsequent verified events create new canonical VVR versions instead of overwriting prior determinations', async () => {
  const domain = new MemoryDomain();
  const service = new ValueIntelligenceService(marketplace, domain);
  await service.initialize();

  const firstSignal = domain.list(RECORD_TYPES.MARKET_SIGNAL)[0];
  const first = await service.verifyMarketEvent({ signalId: firstSignal.signalId, eventType: 'PAYMENT_RECEIVED', realizedAmount: 105 }, 'ADMIN-1');
  const secondSignal = await service.createSignal({ assetId: 'A-1', signalType: 'QUOTED_PRICE', amount: 110 }, 'ADMIN-1');
  const second = await service.verifyMarketEvent({ signalId: secondSignal.signalId, eventType: 'SALE_CLOSED', realizedAmount: 110 }, 'ADMIN-1');

  assert.notEqual(first.canonicalVerifiedValueRecord.verifiedValueRecordId, second.canonicalVerifiedValueRecord.verifiedValueRecordId);
  const history = domain.list(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((record) => record.value).sort((a, b) => a - b), [105, 110]);
  const legacy = domain.get(RECORD_TYPES.VERIFIED_VALUE_RECORD, 'A-1');
  assert.equal(legacy.verifiedValue, 110);
  assert.equal(legacy.canonicalVerifiedValueRecordId, second.canonicalVerifiedValueRecord.verifiedValueRecordId);
});
