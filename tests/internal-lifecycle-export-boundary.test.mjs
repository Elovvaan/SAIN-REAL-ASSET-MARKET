import test from 'node:test';
import assert from 'node:assert/strict';
import { InternalLifecycleService } from '../services/internal-lifecycle-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async lifecycle(input) { this.events.push(structuredClone(input)); return input; }
  seed(type, id, payload = {}) { this.records.set(this.key(type, id), { ...payload }); }
}

function seedCompleteLifecycle(domain) {
  domain.seed(RECORD_TYPES.MARKET_OBSERVATION, 'OBS-1', { observationId: 'OBS-1', state: 'OBSERVED' });
  domain.seed(RECORD_TYPES.RECOGNITION_ASSESSMENT, 'REC-1', { recognitionId: 'REC-1', observationId: 'OBS-1', decision: 'RECOGNIZED' });
  domain.seed(RECORD_TYPES.FINANCIAL_RECORD, 'FR-1', { financialRecordId: 'FR-1', recognitionId: 'REC-1', state: 'RECORDED' });
  domain.seed(RECORD_TYPES.COIN_POSITION, 'CP-1', { coinPositionId: 'CP-1', financialRecordId: 'FR-1', state: 'ACTIVE' });
  domain.seed(RECORD_TYPES.SRA_INSTRUMENT, 'INS-1', { instrumentId: 'INS-1', coinPositionId: 'CP-1', state: 'ISSUED' });
  domain.seed(RECORD_TYPES.MARKETPLACE_LISTING, 'LST-1', { listingId: 'LST-1', instrumentId: 'INS-1', state: 'PUBLISHED' });
  domain.seed(RECORD_TYPES.PARTICIPATION_POSITION, 'PAR-1', { positionId: 'PAR-1', listingId: 'LST-1', participantId: 'OWNER-1', state: 'ACTIVE' });
  domain.seed(RECORD_TYPES.FUNDING_MARKETPLACE_COMMITMENT, 'COM-1', { commitmentId: 'COM-1', listingId: 'LST-1', participantId: 'OWNER-1', state: 'COMMITTED' });
  domain.seed(RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, 'ALL-1', { positionId: 'ALL-1', commitmentId: 'COM-1', participantId: 'OWNER-1', instrumentId: 'INS-1', listingId: 'LST-1', quantity: 100, unit: 'SRA', state: 'ALLOCATED' });
  domain.seed(RECORD_TYPES.SRA_SETTLEMENT_RECORD, 'SET-1', { settlementRecordId: 'SET-1', participantId: 'OWNER-1', instrumentId: 'INS-1', listingId: 'LST-1', quantity: 100, unit: 'SRA', state: 'SETTLED' });
}

const references = {
  observationId: 'OBS-1',
  recognitionId: 'REC-1',
  financialRecordId: 'FR-1',
  coinPositionId: 'CP-1',
  instrumentId: 'INS-1',
  listingId: 'LST-1',
  participationId: 'PAR-1',
  commitmentId: 'COM-1',
  allocationId: 'ALL-1',
  settlementRecordId: 'SET-1',
};

test('incomplete lifecycle is rejected before export', async () => {
  const domain = new MemoryDomain();
  const service = new InternalLifecycleService(domain);
  const inspection = service.inspect({ observationId: 'OBS-MISSING' });
  assert.equal(inspection.complete, false);
  assert.ok(inspection.missing.includes('recognition'));
  await assert.rejects(() => service.createExportPackage({ observationId: 'OBS-MISSING' }), /Internal lifecycle is incomplete/);
});

test('complete internal lifecycle recognizes ownership and creates one immutable export package', async () => {
  const domain = new MemoryDomain();
  seedCompleteLifecycle(domain);
  const service = new InternalLifecycleService(domain);

  const ownership = await service.recognizeOwnership({
    settlementRecordId: 'SET-1',
    allocationPositionId: 'ALL-1',
    ownerId: 'OWNER-1',
  }, 'TEST_AGENT');
  assert.equal(ownership.created, true);
  assert.equal(ownership.ownershipRecognition.state, 'RECOGNIZED');

  const completeReferences = { ...references, ownershipRecognitionId: ownership.ownershipRecognition.ownershipRecognitionId };
  const inspection = service.inspect(completeReferences);
  assert.equal(inspection.complete, true);
  assert.deepEqual(inspection.missing, []);

  const first = await service.createExportPackage({
    references: completeReferences,
    destinationClass: 'UNSPECIFIED_ADAPTER',
  }, 'TEST_AGENT');
  assert.equal(first.created, true);
  assert.equal(first.exportPackage.state, 'READY_FOR_EXPORT');
  assert.equal(first.exportPackage.immutable, true);
  assert.match(first.exportPackage.packageDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.exportPackage.manifest.sourceSystem, 'SRA');
  assert.equal(first.exportPackage.manifest.boundary, 'EXPORT_BOUNDARY');

  const second = await service.createExportPackage({
    references: completeReferences,
    destinationClass: 'UNSPECIFIED_ADAPTER',
  }, 'TEST_AGENT');
  assert.equal(second.created, false);
  assert.equal(second.exportPackage.exportPackageId, first.exportPackage.exportPackageId);
  assert.equal(second.exportPackage.packageDigest, first.exportPackage.packageDigest);
  assert.equal(domain.events.some((event) => event.eventType === 'SRA_ASSET_READY_FOR_EXPORT'), true);
});
