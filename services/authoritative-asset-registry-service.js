import crypto from 'node:crypto';
import {
  AssetRelationship,
  AuthoritativeAssetRegistry,
  PositionReservation,
  RegistryConflictError,
} from '../domain/authoritative-registry.js';
import { RECORD_TYPES } from './persistent-domain-service.js';

function upper(value, fallback = null) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.toUpperCase() : fallback;
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function asAsset(record) {
  if (!record) return null;
  return {
    ...record,
    id: record.id || record.assetId,
    version: Number(record.version || 1),
    lifecycleRecordId: record.lifecycleRecordId || null,
  };
}

function asPosition(record) {
  if (!record) return null;
  return {
    ...record,
    id: record.id || record.positionId,
    assetId: record.assetId,
    version: Number(record.version || 1),
    transferableValue: Number(
      record.transferableValue ??
      record.availableAmount ??
      record.allocatedAmount ??
      record.amount ??
      0,
    ),
  };
}

class KeyedExclusiveRunner {
  constructor() {
    this.tails = new Map();
  }

  async run(key, operation) {
    const previous = this.tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.tails.set(key, current);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}

export class AuthoritativeAssetRegistryService {
  constructor(domain) {
    this.domain = domain;
    const relationshipWrites = new KeyedExclusiveRunner();
    const reservationWrites = new KeyedExclusiveRunner();
    const assetRepository = {
      getById: async (assetId) => asAsset(
        domain.get(RECORD_TYPES.ASSET_ACCOUNT, assetId) ||
        domain.list(RECORD_TYPES.ASSET_ACCOUNT).find((record) => record.assetId === assetId),
      ),
    };
    const relationshipRepository = {
      runExclusive: async (assetId, operation) => relationshipWrites.run(assetId, operation),
      save: async (relationship) => domain.put(
        RECORD_TYPES.AUTHORITATIVE_ASSET_RELATIONSHIP,
        relationship.id,
        relationship,
        { actorId: relationship.recognizedBy || null, eventType: 'AUTHORITATIVE_ASSET_RELATIONSHIP_UPSERTED' },
      ),
      listByAssetId: async (assetId) => domain
        .list(RECORD_TYPES.AUTHORITATIVE_ASSET_RELATIONSHIP)
        .filter((record) => record.assetId === assetId),
    };
    const reservationRepository = {
      runExclusive: async (positionId, operation) => reservationWrites.run(positionId, operation),
      save: async (reservation) => domain.put(
        RECORD_TYPES.POSITION_RESERVATION,
        reservation.id,
        reservation,
        { actorId: reservation.createdBy || null, eventType: 'POSITION_RESERVATION_UPSERTED' },
      ),
      listByPositionId: async (positionId) => domain
        .list(RECORD_TYPES.POSITION_RESERVATION)
        .filter((record) => record.positionId === positionId),
      listByAssetId: async (assetId) => domain
        .list(RECORD_TYPES.POSITION_RESERVATION)
        .filter((record) => record.assetId === assetId),
    };
    const lifecycleRepository = {
      getById: async () => null,
      getByAssetId: async () => null,
      save: async () => null,
    };
    this.registry = new AuthoritativeAssetRegistry({
      assetRepository,
      relationshipRepository,
      reservationRepository,
      lifecycleRepository,
    });
    this.positionRepository = {
      getById: async (positionId) => asPosition(
        domain.get(RECORD_TYPES.PARTICIPATION_POSITION, positionId) ||
        domain.list(RECORD_TYPES.PARTICIPATION_POSITION).find((record) => record.positionId === positionId),
      ),
    };
  }

  listRelationships(assetId) {
    return this.domain.list(RECORD_TYPES.AUTHORITATIVE_ASSET_RELATIONSHIP)
      .filter((record) => !assetId || record.assetId === assetId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  listReservations({ assetId = null, positionId = null, activeOnly = false } = {}) {
    const active = new Set(['HELD', 'CONSUMING']);
    const now = new Date();
    return this.domain.list(RECORD_TYPES.POSITION_RESERVATION)
      .filter((record) => !assetId || record.assetId === assetId)
      .filter((record) => !positionId || record.positionId === positionId)
      .filter((record) => !activeOnly || (
        active.has(record.status) &&
        (!record.expiresAt || new Date(record.expiresAt) > now)
      ))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async registerRelationship(input = {}, actorId) {
    const relationship = new AssetRelationship({
      id: input.id || makeId('AAR'),
      assetId: input.assetId,
      subjectParticipantId: input.subjectParticipantId || input.partyId,
      relationshipType: upper(input.relationshipType),
      objectParticipantId: input.objectParticipantId || null,
      instrumentId: input.instrumentId || null,
      positionId: input.positionId || null,
      effectiveAt: input.effectiveAt || new Date().toISOString(),
      expiresAt: input.expiresAt || null,
      priority: input.priority ?? null,
      authorityReference: input.authorityReference,
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
      restrictions: Array.isArray(input.restrictions) ? input.restrictions : [],
      status: upper(input.status, 'ACTIVE'),
      version: Number(input.version || 1),
    });
    relationship.recognizedBy = actorId;
    const result = await this.registry.registerRelationship(relationship, {
      expectedAssetVersion: input.expectedAssetVersion,
      actorId,
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.AUTHORITATIVE_ASSET_RELATIONSHIP,
      objectId: result.id,
      eventType: 'AUTHORITATIVE_ASSET_RELATIONSHIP_REGISTERED',
      actorId,
      payload: {
        assetId: result.assetId,
        relationshipType: result.relationshipType,
        subjectParticipantId: result.subjectParticipantId,
        authorityReference: result.authorityReference,
      },
    });
    return result;
  }

  async reservePosition(input = {}, actorId) {
    const reservation = new PositionReservation({
      id: input.id || makeId('RSV'),
      assetId: input.assetId,
      positionId: input.positionId,
      amount: Number(input.amount),
      purpose: upper(input.purpose),
      instructionId: input.instructionId || null,
      priority: input.priority ?? null,
      expiresAt: input.expiresAt || null,
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
      status: upper(input.status, 'HELD'),
    });
    reservation.createdBy = actorId;
    const result = await this.registry.reservePosition(reservation, {
      expectedPositionVersion: input.expectedPositionVersion,
      actorId,
      positionRepository: this.positionRepository,
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.POSITION_RESERVATION,
      objectId: result.id,
      eventType: 'POSITION_CAPACITY_RESERVED',
      actorId,
      payload: {
        assetId: result.assetId,
        positionId: result.positionId,
        amount: result.amount,
        purpose: result.purpose,
        instructionId: result.instructionId,
      },
    });
    return result;
  }

  async releaseReservation(reservationId, { reason, evidenceIds = [] }, actorId) {
    const current = this.domain.get(RECORD_TYPES.POSITION_RESERVATION, reservationId);
    if (!current) throw new Error('Position reservation not found.');
    const reservation = new PositionReservation(current);
    reservation.release(reason, evidenceIds);
    reservation.releasedBy = actorId;
    await this.domain.put(RECORD_TYPES.POSITION_RESERVATION, reservation.id, reservation, {
      actorId,
      eventType: 'POSITION_RESERVATION_RELEASED',
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.POSITION_RESERVATION,
      objectId: reservation.id,
      eventType: 'POSITION_RESERVATION_RELEASED',
      actorId,
      payload: { reason, evidenceIds },
    });
    return reservation;
  }

  async snapshot(assetId) {
    const asset = this.domain.get(RECORD_TYPES.ASSET_ACCOUNT, assetId) ||
      this.domain.list(RECORD_TYPES.ASSET_ACCOUNT).find((record) => record.assetId === assetId);
    if (!asset) throw new Error('Asset not found.');
    const positions = this.domain.list(RECORD_TYPES.PARTICIPATION_POSITION)
      .filter((record) => record.assetId === assetId);
    const transferableCapacity = positions.reduce((sum, record) => sum + Number(
      record.transferableValue ?? record.availableAmount ?? record.allocatedAmount ?? record.amount ?? 0,
    ), 0);
    const allocatedAmount = positions.reduce((sum, record) => sum + Number(
      record.allocatedAmount ?? record.amount ?? 0,
    ), 0);
    const encumberedAmount = this.listRelationships(assetId)
      .filter((record) => record.status === 'ACTIVE' && record.relationshipType === 'SECURED_PARTY_OF')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    return this.registry.buildSnapshot({
      assetId,
      recognizedValue: Number(asset.verifiedValue || asset.value || 0),
      transferableCapacity,
      allocatedAmount,
      encumberedAmount,
    });
  }

  explainError(error) {
    if (!(error instanceof RegistryConflictError)) return null;
    const explanations = {
      EXCLUSIVE_OWNER_CONFLICT: 'A different active owner is already recognized for this asset. Close or supersede that relationship before registering another exclusive owner.',
      EXCLUSIVE_CUSTODY_CONFLICT: 'A different active custodian conflicts with an exclusive custody claim. Every coexisting custodian must be expressly non-exclusive.',
      RESERVATION_POSITION_MISMATCH: 'The requested reservation does not point to the supplied asset and position.',
      INSUFFICIENT_TRANSFERABLE_CAPACITY: 'The requested amount exceeds the position capacity that remains unreserved and transferable.',
      STALE_ASSET_VERSION: 'The asset changed after the request was prepared. Reload the asset state before submitting again.',
      STALE_POSITION_VERSION: 'The participation position changed after the request was prepared. Reload the position before reserving capacity.',
    };
    return {
      code: error.code,
      message: error.message,
      explanation: explanations[error.code] || 'The requested state change conflicts with the authoritative registry.',
      details: error.details,
    };
  }
}
