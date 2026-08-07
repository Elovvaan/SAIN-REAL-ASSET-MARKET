import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AssetRelationship,
  AuthoritativeAssetRegistry,
  ConflictDetectionService,
  PositionReservation,
  RegistryConflictError,
} from '../domain/authoritative-registry.js';

function memoryRepository(items = [], { exclusive = false } = {}) {
  const records = new Map(items.map((item) => [item.id, item]));
  const tails = new Map();
  return {
    async getById(id) { return records.get(id) || null; },
    async getByAssetId(assetId) { return [...records.values()].find((item) => item.assetId === assetId) || null; },
    async listByAssetId(assetId) { return [...records.values()].filter((item) => item.assetId === assetId); },
    async listByPositionId(positionId) { return [...records.values()].filter((item) => item.positionId === positionId); },
    async save(item) { await new Promise((resolve) => setTimeout(resolve, 5)); records.set(item.id, item); return item; },
    async runExclusive(key, operation) {
      if (!exclusive) return operation();
      const previous = tails.get(key) || Promise.resolve();
      let release;
      const current = new Promise((resolve) => { release = resolve; });
      tails.set(key, current);
      await previous.catch(() => {});
      try { return await operation(); }
      finally { release(); if (tails.get(key) === current) tails.delete(key); }
    },
    values() { return [...records.values()]; },
  };
}

function custody(id, party, restrictions = []) {
  return new AssetRelationship({ id, assetId: 'AST-1', subjectParticipantId: party, relationshipType: 'CUSTODIAN_OF', authorityReference: `AUTH-${id}`, restrictions });
}

test('rejects a competing active owner for the same asset', () => {
  const current = new AssetRelationship({ id: 'REL-1', assetId: 'AST-1', subjectParticipantId: 'PARTY-A', relationshipType: 'OWNS', authorityReference: 'AUTH-1' });
  const candidate = new AssetRelationship({ id: 'REL-2', assetId: 'AST-1', subjectParticipantId: 'PARTY-B', relationshipType: 'OWNS', authorityReference: 'AUTH-2' });
  assert.throws(() => ConflictDetectionService.assertRelationshipAllowed(candidate, [current]), (error) => error instanceof RegistryConflictError && error.code === 'EXCLUSIVE_OWNER_CONFLICT');
});

test('allows custody sharing only when both custodians are non-exclusive', () => {
  const mode = [{ type: 'CUSTODY_MODE', value: 'NON_EXCLUSIVE' }];
  assert.equal(ConflictDetectionService.assertRelationshipAllowed(custody('REL-2', 'CUSTODIAN-B', mode), [custody('REL-1', 'CUSTODIAN-A', mode)]), true);
});

test('rejects exclusive custody beside an existing non-exclusive custodian', () => {
  const current = custody('REL-1', 'CUSTODIAN-A', [{ type: 'CUSTODY_MODE', value: 'NON_EXCLUSIVE' }]);
  assert.throws(() => ConflictDetectionService.assertRelationshipAllowed(custody('REL-2', 'CUSTODIAN-B'), [current]), (error) => error instanceof RegistryConflictError && error.code === 'EXCLUSIVE_CUSTODY_CONFLICT');
});

test('rejects reservations above remaining transferable capacity', () => {
  const position = { id: 'POS-1', assetId: 'AST-1', transferableValue: 100 };
  const existing = new PositionReservation({ id: 'RES-1', assetId: 'AST-1', positionId: 'POS-1', amount: 70, purpose: 'SETTLEMENT' });
  const candidate = new PositionReservation({ id: 'RES-2', assetId: 'AST-1', positionId: 'POS-1', amount: 40, purpose: 'TRANSFER' });
  assert.throws(() => ConflictDetectionService.assertReservationAllowed({ position, candidate, reservations: [existing] }), (error) => error instanceof RegistryConflictError && error.code === 'INSUFFICIENT_TRANSFERABLE_CAPACITY' && error.details.available === 30);
});

test('registry enforces optimistic asset version before relationship registration', async () => {
  const registry = new AuthoritativeAssetRegistry({ assetRepository: memoryRepository([{ id: 'AST-1', version: 3 }]), relationshipRepository: memoryRepository(), reservationRepository: memoryRepository(), lifecycleRepository: null });
  const candidate = new AssetRelationship({ id: 'REL-1', assetId: 'AST-1', subjectParticipantId: 'PARTY-A', relationshipType: 'OWNS', authorityReference: 'AUTH-1' });
  await assert.rejects(registry.registerRelationship(candidate, { expectedAssetVersion: 2, actorId: 'ADMIN-1' }), (error) => error instanceof RegistryConflictError && error.code === 'STALE_ASSET_VERSION');
});

test('registry saves a valid relationship and records its lifecycle event', async () => {
  const assetRepository = memoryRepository([{ id: 'AST-1', version: 1, lifecycleRecordId: 'LIFE-1' }]);
  const relationshipRepository = memoryRepository();
  const lifecycle = { id: 'LIFE-1', assetId: 'AST-1', events: [], append(event) { this.events.push(event); return event; } };
  const registry = new AuthoritativeAssetRegistry({ assetRepository, relationshipRepository, reservationRepository: memoryRepository(), lifecycleRepository: memoryRepository([lifecycle]) });
  const candidate = new AssetRelationship({ id: 'REL-1', assetId: 'AST-1', subjectParticipantId: 'PARTY-A', relationshipType: 'OWNS', authorityReference: 'AUTH-1', evidenceIds: ['EVID-1'] });
  await registry.registerRelationship(candidate, { expectedAssetVersion: 1, actorId: 'ADMIN-1' });
  assert.equal((await relationshipRepository.getById('REL-1')).subjectParticipantId, 'PARTY-A');
  assert.equal(lifecycle.events[0].type, 'ASSET_RELATIONSHIP_REGISTERED');
});

test('serializes concurrent competing owner registrations', async () => {
  const relationshipRepository = memoryRepository([], { exclusive: true });
  const registry = new AuthoritativeAssetRegistry({ assetRepository: memoryRepository([{ id: 'AST-1', version: 1 }]), relationshipRepository, reservationRepository: memoryRepository(), lifecycleRepository: null });
  const candidates = ['PARTY-A', 'PARTY-B'].map((party, index) => new AssetRelationship({ id: `REL-${index + 1}`, assetId: 'AST-1', subjectParticipantId: party, relationshipType: 'OWNS', authorityReference: `AUTH-${index + 1}` }));
  const results = await Promise.allSettled(candidates.map((candidate) => registry.registerRelationship(candidate, { expectedAssetVersion: 1, actorId: 'ADMIN-1' })));
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(relationshipRepository.values().length, 1);
});

test('serializes concurrent reservations so capacity cannot be oversubscribed', async () => {
  const reservationRepository = memoryRepository([], { exclusive: true });
  const registry = new AuthoritativeAssetRegistry({ assetRepository: memoryRepository([{ id: 'AST-1', version: 1 }]), relationshipRepository: memoryRepository(), reservationRepository, lifecycleRepository: null });
  const positionRepository = memoryRepository([{ id: 'POS-1', assetId: 'AST-1', version: 1, transferableValue: 100 }]);
  const candidates = [60, 60].map((amount, index) => new PositionReservation({ id: `RES-${index + 1}`, assetId: 'AST-1', positionId: 'POS-1', amount, purpose: 'TRANSFER' }));
  const results = await Promise.allSettled(candidates.map((candidate) => registry.reservePosition(candidate, { expectedPositionVersion: 1, actorId: 'ADMIN-1', positionRepository })));
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(reservationRepository.values().reduce((sum, record) => sum + record.amount, 0), 60);
});

test('state snapshot excludes expired active-state reservations', async () => {
  const reservationRepository = memoryRepository([
    new PositionReservation({ id: 'RES-ACTIVE', assetId: 'AST-1', positionId: 'POS-1', amount: 15, purpose: 'SETTLEMENT', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    new PositionReservation({ id: 'RES-EXPIRED', assetId: 'AST-1', positionId: 'POS-1', amount: 40, purpose: 'TRANSFER', expiresAt: new Date(Date.now() - 60_000).toISOString() }),
  ]);
  const registry = new AuthoritativeAssetRegistry({ assetRepository: memoryRepository([{ id: 'AST-1', version: 7 }]), relationshipRepository: memoryRepository(), reservationRepository, lifecycleRepository: null });
  const snapshot = await registry.buildSnapshot({ assetId: 'AST-1', recognizedValue: 150, transferableCapacity: 100, allocatedAmount: 20, encumberedAmount: 30 });
  assert.equal(snapshot.reservedAmount, 15);
  assert.equal(snapshot.availableCapacity, 35);
});
