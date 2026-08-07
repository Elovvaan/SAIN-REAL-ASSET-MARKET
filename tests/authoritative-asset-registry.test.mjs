import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AssetRelationship,
  AuthoritativeAssetRegistry,
  ConflictDetectionService,
  PositionReservation,
  RegistryConflictError,
} from '../domain/authoritative-registry.js';

function memoryRepository(items = []) {
  const records = new Map(items.map((item) => [item.id, item]));
  return {
    async getById(id) { return records.get(id) || null; },
    async getByAssetId(assetId) {
      return [...records.values()].find((item) => item.assetId === assetId) || null;
    },
    async listByAssetId(assetId) {
      return [...records.values()].filter((item) => item.assetId === assetId);
    },
    async listByPositionId(positionId) {
      return [...records.values()].filter((item) => item.positionId === positionId);
    },
    async save(item) { records.set(item.id, item); return item; },
    values() { return [...records.values()]; },
  };
}

test('rejects a competing active owner for the same asset', () => {
  const current = new AssetRelationship({
    id: 'REL-1',
    assetId: 'AST-1',
    subjectParticipantId: 'PARTY-A',
    relationshipType: 'OWNS',
    authorityReference: 'AUTH-1',
  });
  const candidate = new AssetRelationship({
    id: 'REL-2',
    assetId: 'AST-1',
    subjectParticipantId: 'PARTY-B',
    relationshipType: 'OWNS',
    authorityReference: 'AUTH-2',
  });

  assert.throws(
    () => ConflictDetectionService.assertRelationshipAllowed(candidate, [current]),
    (error) => error instanceof RegistryConflictError && error.code === 'EXCLUSIVE_OWNER_CONFLICT',
  );
});

test('allows expressly non-exclusive custody relationships', () => {
  const current = new AssetRelationship({
    id: 'REL-1',
    assetId: 'AST-1',
    subjectParticipantId: 'CUSTODIAN-A',
    relationshipType: 'CUSTODIAN_OF',
    authorityReference: 'AUTH-1',
    restrictions: [{ type: 'CUSTODY_MODE', value: 'NON_EXCLUSIVE' }],
  });
  const candidate = new AssetRelationship({
    id: 'REL-2',
    assetId: 'AST-1',
    subjectParticipantId: 'CUSTODIAN-B',
    relationshipType: 'CUSTODIAN_OF',
    authorityReference: 'AUTH-2',
  });

  assert.equal(
    ConflictDetectionService.assertRelationshipAllowed(candidate, [current]),
    true,
  );
});

test('rejects reservations above remaining transferable capacity', () => {
  const position = {
    id: 'POS-1',
    assetId: 'AST-1',
    transferableValue: 100,
  };
  const existing = new PositionReservation({
    id: 'RES-1',
    assetId: 'AST-1',
    positionId: 'POS-1',
    amount: 70,
    purpose: 'SETTLEMENT',
  });
  const candidate = new PositionReservation({
    id: 'RES-2',
    assetId: 'AST-1',
    positionId: 'POS-1',
    amount: 40,
    purpose: 'TRANSFER',
  });

  assert.throws(
    () => ConflictDetectionService.assertReservationAllowed({
      position,
      candidate,
      reservations: [existing],
    }),
    (error) =>
      error instanceof RegistryConflictError &&
      error.code === 'INSUFFICIENT_TRANSFERABLE_CAPACITY' &&
      error.details.available === 30,
  );
});

test('registry enforces optimistic asset version before relationship registration', async () => {
  const assetRepository = memoryRepository([
    { id: 'AST-1', version: 3, lifecycleRecordId: 'LIFE-1' },
  ]);
  const lifecycle = {
    id: 'LIFE-1',
    assetId: 'AST-1',
    events: [],
    append(event) { this.events.push(event); return event; },
  };
  const lifecycleRepository = memoryRepository([lifecycle]);
  const registry = new AuthoritativeAssetRegistry({
    assetRepository,
    relationshipRepository: memoryRepository(),
    reservationRepository: memoryRepository(),
    lifecycleRepository,
  });
  const relationship = new AssetRelationship({
    id: 'REL-1',
    assetId: 'AST-1',
    subjectParticipantId: 'PARTY-A',
    relationshipType: 'OWNS',
    authorityReference: 'AUTH-1',
  });

  await assert.rejects(
    registry.registerRelationship(relationship, {
      expectedAssetVersion: 2,
      actorId: 'ADMIN-1',
    }),
    (error) => error instanceof RegistryConflictError && error.code === 'STALE_ASSET_VERSION',
  );
});

test('registry saves a valid relationship and records its lifecycle event', async () => {
  const assetRepository = memoryRepository([
    { id: 'AST-1', version: 1, lifecycleRecordId: 'LIFE-1' },
  ]);
  const relationshipRepository = memoryRepository();
  const lifecycle = {
    id: 'LIFE-1',
    assetId: 'AST-1',
    events: [],
    append(event) { this.events.push(event); return event; },
  };
  const lifecycleRepository = memoryRepository([lifecycle]);
  const registry = new AuthoritativeAssetRegistry({
    assetRepository,
    relationshipRepository,
    reservationRepository: memoryRepository(),
    lifecycleRepository,
  });
  const relationship = new AssetRelationship({
    id: 'REL-1',
    assetId: 'AST-1',
    subjectParticipantId: 'PARTY-A',
    relationshipType: 'OWNS',
    authorityReference: 'AUTH-1',
    evidenceIds: ['EVID-1'],
  });

  await registry.registerRelationship(relationship, {
    expectedAssetVersion: 1,
    actorId: 'ADMIN-1',
  });

  assert.equal((await relationshipRepository.getById('REL-1')).subjectParticipantId, 'PARTY-A');
  assert.equal(lifecycle.events.length, 1);
  assert.equal(lifecycle.events[0].type, 'ASSET_RELATIONSHIP_REGISTERED');
});

test('state snapshot subtracts allocations, reservations, and encumbrances', async () => {
  const registry = new AuthoritativeAssetRegistry({
    assetRepository: memoryRepository([{ id: 'AST-1', version: 7 }]),
    relationshipRepository: memoryRepository(),
    reservationRepository: memoryRepository([
      new PositionReservation({
        id: 'RES-1',
        assetId: 'AST-1',
        positionId: 'POS-1',
        amount: 15,
        purpose: 'SETTLEMENT',
      }),
    ]),
    lifecycleRepository: null,
  });

  const snapshot = await registry.buildSnapshot({
    assetId: 'AST-1',
    recognizedValue: 150,
    transferableCapacity: 100,
    allocatedAmount: 20,
    encumberedAmount: 30,
  });

  assert.equal(snapshot.assetVersion, 7);
  assert.equal(snapshot.reservedAmount, 15);
  assert.equal(snapshot.availableCapacity, 35);
});
