import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetRelationshipLedgerService } from '../services/asset-relationship-ledger-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)); }
  async put(type, id, value) { this.records.set(this.key(type, id), structuredClone(value)); return value; }
  async lifecycle(event) { this.events.push(structuredClone(event)); return event; }
  seed(type, id, value) { this.records.set(this.key(type, id), structuredClone(value)); }
}

function seededDomain() {
  const domain = new MemoryDomain();
  domain.seed(RECORD_TYPES.SRA_INSTRUMENT, 'INS-1', { instrumentId: 'INS-1', issuerId: 'SRA', rights: ['PARTICIPATE'], state: 'ISSUED' });
  domain.seed(RECORD_TYPES.MARKETPLACE_LISTING, 'LIST-1', { listingId: 'LIST-1', instrumentId: 'INS-1', state: 'PUBLISHED' });
  domain.seed(RECORD_TYPES.PARTICIPATION_POSITION, 'PART-1', { positionId: 'PART-1', listingId: 'LIST-1', instrumentId: 'INS-1', participantId: 'USER-A', quantity: 100, state: 'ACTIVE' });
  domain.seed(RECORD_TYPES.FUNDING_MARKETPLACE_COMMITMENT, 'COM-1', { commitmentId: 'COM-1', listingId: 'LIST-1', instrumentId: 'INS-1', participantId: 'USER-A', quantity: 100, amount: 100, state: 'COMMITTED' });
  domain.seed(RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, 'ALLOC-1', { positionId: 'ALLOC-1', commitmentId: 'COM-1', listingId: 'LIST-1', instrumentId: 'INS-1', participantId: 'USER-A', quantity: 100, amount: 100, state: 'ALLOCATED' });
  domain.seed(RECORD_TYPES.SRA_SETTLEMENT_RECORD, 'SET-1', { settlementRecordId: 'SET-1', listingId: 'LIST-1', instrumentId: 'INS-1', participantId: 'USER-A', quantity: 100, amount: 100, state: 'SETTLED' });
  domain.seed(RECORD_TYPES.OWNERSHIP_RECOGNITION, 'OWN-1', { ownershipRecognitionId: 'OWN-1', listingId: 'LIST-1', instrumentId: 'INS-1', ownerId: 'USER-A', ownerType: 'PARTICIPANT', quantity: 100, state: 'RECOGNIZED' });
  domain.seed(RECORD_TYPES.EXPORT_PACKAGE, 'EXP-1', { exportPackageId: 'EXP-1', ownershipRecognitionId: 'OWN-1', state: 'READY_FOR_EXPORT' });
  return domain;
}

test('synchronization appends the complete internal relationship history', async () => {
  const service = new AssetRelationshipLedgerService(seededDomain());
  const result = await service.synchronizeInstrument('INS-1', 'ADMIN-1');
  assert.deepEqual(result.relationships.map((record) => record.relationshipType), ['ISSUER', 'ORIGINAL_OWNER', 'PARTICIPANT', 'COMMITTER', 'ALLOCATED_HOLDER', 'SETTLED_PARTY', 'CURRENT_OWNER', 'EXPORT_ORIGIN']);
  assert.equal(result.relationshipCount, 8);
  assert.equal(result.relationships.every((record) => record.internalOnly === true), true);
});

test('relationship synchronization is idempotent and append-only', async () => {
  const service = new AssetRelationshipLedgerService(seededDomain());
  const first = await service.synchronizeInstrument('INS-1', 'ADMIN-1');
  const second = await service.synchronizeInstrument('INS-1', 'ADMIN-1');
  assert.equal(first.created, 8);
  assert.equal(second.created, 0);
  assert.equal(service.list('INS-1').length, 8);
});

test('public export view excludes private participation and settlement detail', async () => {
  const service = new AssetRelationshipLedgerService(seededDomain());
  await service.synchronizeInstrument('INS-1', 'ADMIN-1');
  const view = service.publicView('INS-1');
  assert.equal(view.schema, 'SRA_PUBLIC_RELATIONSHIP_VIEW');
  assert.equal(view.participantCount, 1);
  assert.deepEqual(view.relationships.map((record) => record.relationshipType), ['ISSUER', 'ORIGINAL_OWNER', 'CURRENT_OWNER']);
  assert.equal(view.relationships.some((record) => record.relationshipType === 'COMMITTER'), false);
  assert.equal(view.relationships.some((record) => record.relationshipType === 'SETTLED_PARTY'), false);
});

test('new participation appends without changing previous relationship records', async () => {
  const domain = seededDomain();
  const service = new AssetRelationshipLedgerService(domain);
  await service.synchronizeInstrument('INS-1', 'ADMIN-1');
  const before = service.list('INS-1').map((record) => record.relationshipId);
  domain.seed(RECORD_TYPES.PARTICIPATION_POSITION, 'PART-2', { positionId: 'PART-2', listingId: 'LIST-1', instrumentId: 'INS-1', participantId: 'USER-B', quantity: 50, state: 'ACTIVE' });
  await service.synchronizeInstrument('INS-1', 'ADMIN-1');
  const after = service.list('INS-1');
  assert.equal(after.length, 9);
  assert.deepEqual(after.slice(0, before.length).map((record) => record.relationshipId), before);
  assert.equal(after.at(-1).partyId, 'USER-B');
});
