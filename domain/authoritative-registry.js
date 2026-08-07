const ACTIVE_RELATIONSHIP_STATES = new Set(['PENDING', 'ACTIVE']);
const ACTIVE_RESERVATION_STATES = new Set(['HELD', 'CONSUMING']);

export const ASSET_RELATIONSHIP_TYPES = Object.freeze([
  'OWNS',
  'BENEFICIAL_OWNER_OF',
  'REGISTERED_HOLDER_OF',
  'CONTROLS',
  'CUSTODIAN_OF',
  'SECURED_PARTY_OF',
  'SERVICES',
  'NOMINEE_FOR',
]);

export class AssetRelationship {
  constructor({
    id,
    assetId,
    subjectParticipantId,
    relationshipType,
    objectParticipantId = null,
    instrumentId = null,
    positionId = null,
    effectiveAt = new Date().toISOString(),
    expiresAt = null,
    priority = null,
    authorityReference,
    evidenceIds = [],
    restrictions = [],
    status = 'ACTIVE',
    version = 1,
  }) {
    if (!id || !assetId || !subjectParticipantId || !authorityReference) {
      throw new Error('AssetRelationship requires id, assetId, subjectParticipantId, and authorityReference.');
    }
    if (!ASSET_RELATIONSHIP_TYPES.includes(relationshipType)) {
      throw new Error(`Unsupported asset relationship type: ${relationshipType}`);
    }
    this.id = id;
    this.assetId = assetId;
    this.subjectParticipantId = subjectParticipantId;
    this.relationshipType = relationshipType;
    this.objectParticipantId = objectParticipantId;
    this.instrumentId = instrumentId;
    this.positionId = positionId;
    this.effectiveAt = effectiveAt;
    this.expiresAt = expiresAt;
    this.priority = priority;
    this.authorityReference = authorityReference;
    this.evidenceIds = [...evidenceIds];
    this.restrictions = [...restrictions];
    this.status = status;
    this.version = version;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  close(reason, evidenceIds = []) {
    if (!reason) throw new Error('Relationship closure reason is required.');
    this.status = 'CLOSED';
    this.expiresAt = this.expiresAt || new Date().toISOString();
    this.restrictions.push({ type: 'CLOSURE_REASON', value: reason });
    this.evidenceIds.push(...evidenceIds.filter((id) => !this.evidenceIds.includes(id)));
    this.version += 1;
    this.updatedAt = new Date().toISOString();
  }
}

export class PositionReservation {
  constructor({
    id,
    assetId,
    positionId,
    amount,
    purpose,
    instructionId = null,
    priority = null,
    expiresAt = null,
    evidenceIds = [],
    status = 'HELD',
  }) {
    if (!id || !assetId || !positionId || !purpose) {
      throw new Error('PositionReservation requires id, assetId, positionId, and purpose.');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('PositionReservation amount must be greater than zero.');
    }
    this.id = id;
    this.assetId = assetId;
    this.positionId = positionId;
    this.amount = amount;
    this.purpose = purpose;
    this.instructionId = instructionId;
    this.priority = priority;
    this.expiresAt = expiresAt;
    this.evidenceIds = [...evidenceIds];
    this.status = status;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  release(reason, evidenceIds = []) {
    if (!reason) throw new Error('Reservation release reason is required.');
    this.status = 'RELEASED';
    this.releaseReason = reason;
    this.evidenceIds.push(...evidenceIds.filter((id) => !this.evidenceIds.includes(id)));
    this.updatedAt = new Date().toISOString();
  }
}

export class AssetStateSnapshot {
  constructor({
    assetId,
    assetVersion,
    recognizedValue = 0,
    transferableCapacity = 0,
    allocatedAmount = 0,
    reservedAmount = 0,
    encumberedAmount = 0,
    relationships = [],
    restrictions = [],
    sourceEventId = null,
    createdAt = new Date().toISOString(),
  }) {
    this.assetId = assetId;
    this.assetVersion = assetVersion;
    this.recognizedValue = recognizedValue;
    this.transferableCapacity = transferableCapacity;
    this.allocatedAmount = allocatedAmount;
    this.reservedAmount = reservedAmount;
    this.encumberedAmount = encumberedAmount;
    this.availableCapacity = Math.max(
      0,
      transferableCapacity - allocatedAmount - reservedAmount - encumberedAmount,
    );
    this.relationships = relationships;
    this.restrictions = restrictions;
    this.sourceEventId = sourceEventId;
    this.createdAt = createdAt;
  }
}

export class RegistryConflictError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RegistryConflictError';
    this.code = code;
    this.details = details;
  }
}

export class ConflictDetectionService {
  static assertRelationshipAllowed(candidate, relationships = []) {
    const active = relationships.filter((relationship) =>
      ACTIVE_RELATIONSHIP_STATES.has(relationship.status),
    );

    if (candidate.relationshipType === 'OWNS') {
      const competingOwners = active.filter((relationship) =>
        relationship.assetId === candidate.assetId &&
        relationship.relationshipType === 'OWNS' &&
        relationship.subjectParticipantId !== candidate.subjectParticipantId,
      );
      if (competingOwners.length > 0) {
        throw new RegistryConflictError(
          'EXCLUSIVE_OWNER_CONFLICT',
          'The asset already has a different active owner.',
          { relationshipIds: competingOwners.map(({ id }) => id) },
        );
      }
    }

    if (candidate.relationshipType === 'CUSTODIAN_OF') {
      const exclusiveCustodians = active.filter((relationship) =>
        relationship.assetId === candidate.assetId &&
        relationship.relationshipType === 'CUSTODIAN_OF' &&
        relationship.subjectParticipantId !== candidate.subjectParticipantId &&
        !relationship.restrictions.some(({ type, value }) =>
          type === 'CUSTODY_MODE' && value === 'NON_EXCLUSIVE',
        ),
      );
      if (exclusiveCustodians.length > 0) {
        throw new RegistryConflictError(
          'EXCLUSIVE_CUSTODY_CONFLICT',
          'The asset already has a different exclusive custodian.',
          { relationshipIds: exclusiveCustodians.map(({ id }) => id) },
        );
      }
    }

    return true;
  }

  static assertReservationAllowed({ position, candidate, reservations = [] }) {
    if (position.assetId !== candidate.assetId || position.id !== candidate.positionId) {
      throw new RegistryConflictError(
        'RESERVATION_POSITION_MISMATCH',
        'The reservation does not match the supplied position.',
      );
    }
    const activeReserved = reservations
      .filter((reservation) =>
        reservation.positionId === position.id &&
        ACTIVE_RESERVATION_STATES.has(reservation.status) &&
        (!reservation.expiresAt || new Date(reservation.expiresAt) > new Date()),
      )
      .reduce((total, reservation) => total + reservation.amount, 0);
    const available = Math.max(0, Number(position.transferableValue || 0) - activeReserved);
    if (candidate.amount > available) {
      throw new RegistryConflictError(
        'INSUFFICIENT_TRANSFERABLE_CAPACITY',
        'Reservation amount exceeds currently transferable capacity.',
        { requested: candidate.amount, available, activeReserved },
      );
    }
    return true;
  }
}

export class AuthoritativeAssetRegistry {
  constructor({ assetRepository, relationshipRepository, reservationRepository, lifecycleRepository }) {
    this.assetRepository = assetRepository;
    this.relationshipRepository = relationshipRepository;
    this.reservationRepository = reservationRepository;
    this.lifecycleRepository = lifecycleRepository;
  }

  async registerRelationship(relationship, { expectedAssetVersion, actorId }) {
    const asset = await this.assetRepository.getById(relationship.assetId);
    if (!asset) throw new Error(`Asset not found: ${relationship.assetId}`);
    if (expectedAssetVersion != null && asset.version !== expectedAssetVersion) {
      throw new RegistryConflictError(
        'STALE_ASSET_VERSION',
        'Asset version changed before the relationship could be registered.',
        { expectedAssetVersion, actualAssetVersion: asset.version },
      );
    }
    const relationships = await this.relationshipRepository.listByAssetId(asset.id);
    ConflictDetectionService.assertRelationshipAllowed(relationship, relationships);
    await this.relationshipRepository.save(relationship);
    await this.#appendLifecycle(asset, {
      type: 'ASSET_RELATIONSHIP_REGISTERED',
      actorId,
      relationshipId: relationship.id,
      relationshipType: relationship.relationshipType,
      authorityReference: relationship.authorityReference,
      evidenceIds: relationship.evidenceIds,
    });
    return relationship;
  }

  async reservePosition(candidate, { expectedPositionVersion, actorId, positionRepository }) {
    const position = await positionRepository.getById(candidate.positionId);
    if (!position) throw new Error(`Position not found: ${candidate.positionId}`);
    if (expectedPositionVersion != null && position.version !== expectedPositionVersion) {
      throw new RegistryConflictError(
        'STALE_POSITION_VERSION',
        'Position version changed before capacity could be reserved.',
        { expectedPositionVersion, actualPositionVersion: position.version },
      );
    }
    const reservations = await this.reservationRepository.listByPositionId(position.id);
    ConflictDetectionService.assertReservationAllowed({ position, candidate, reservations });
    await this.reservationRepository.save(candidate);
    await this.#appendLifecycle({ id: position.assetId, lifecycleRecordId: null }, {
      type: 'POSITION_CAPACITY_RESERVED',
      actorId,
      positionId: position.id,
      reservationId: candidate.id,
      amount: candidate.amount,
      purpose: candidate.purpose,
      evidenceIds: candidate.evidenceIds,
    });
    return candidate;
  }

  async buildSnapshot({ assetId, recognizedValue = 0, transferableCapacity = 0, allocatedAmount = 0, encumberedAmount = 0, sourceEventId = null }) {
    const asset = await this.assetRepository.getById(assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);
    const relationships = await this.relationshipRepository.listByAssetId(assetId);
    const reservations = await this.reservationRepository.listByAssetId(assetId);
    const reservedAmount = reservations
      .filter((reservation) => ACTIVE_RESERVATION_STATES.has(reservation.status))
      .reduce((total, reservation) => total + reservation.amount, 0);
    return new AssetStateSnapshot({
      assetId,
      assetVersion: asset.version,
      recognizedValue,
      transferableCapacity,
      allocatedAmount,
      reservedAmount,
      encumberedAmount,
      relationships: relationships.filter((relationship) =>
        ACTIVE_RELATIONSHIP_STATES.has(relationship.status),
      ),
      sourceEventId,
    });
  }

  async #appendLifecycle(asset, event) {
    if (!this.lifecycleRepository) return;
    const lifecycle = asset.lifecycleRecordId
      ? await this.lifecycleRepository.getById(asset.lifecycleRecordId)
      : await this.lifecycleRepository.getByAssetId(asset.id);
    if (!lifecycle) return;
    lifecycle.append(event);
    await this.lifecycleRepository.save(lifecycle);
  }
}
