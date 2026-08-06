const POSITION_TYPES = ['COIN_POSITION', 'SRA_COIN_POSITION'];
const locks = new Map();

function now() { return new Date().toISOString(); }
function positive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}
function positionId(record) { return record?.coinPositionId || record?.positionId || record?.id || null; }
function ownerId(record) { return record?.participantId || record?.ownerParticipantId || record?.ownerId || record?.accountHolderId || null; }
function instrumentId(record) { return record?.instrumentId || record?.sraInstrumentId || record?.linkedInstrumentId || null; }
function available(record) {
  const value = record?.availableQuantity ?? record?.quantityAvailable ?? record?.quantity ?? record?.balance;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function deterministicChildId(parentId, sequence) { return `${parentId}-SEG-${String(sequence).padStart(4, '0')}`; }

export class SraCoinPositionSegmentationService {
  constructor(domain) { this.domain = domain; }

  resolve(id) {
    for (const type of POSITION_TYPES) {
      const record = this.domain.get(type, id);
      if (record) return { type, record };
    }
    throw new Error('SRA Coin Position was not found.');
  }

  children(parentId) {
    const records = [];
    for (const type of POSITION_TYPES) {
      for (const record of this.domain.list(type)) {
        if ((record.parentPositionId || record.sourcePositionId) === parentId) records.push({ type, record });
      }
    }
    return records;
  }

  activeHeldQuantity(parentId) {
    return this.domain.list('SRA_TRANSACTION')
      .filter((record) => record.transactionType === 'PRE_ALLOCATION_RESERVATION'
        && record.positionReservation?.positionId === parentId
        && record.positionReservation?.state === 'HELD')
      .reduce((sum, record) => sum + Number(record.positionReservation?.quantity || 0), 0);
  }

  preview(input = {}) {
    const parentId = String(input.positionId || '').trim();
    if (!parentId) throw new Error('positionId is required.');
    const segmentQuantity = positive(input.quantity, 'quantity');
    const { type, record } = this.resolve(parentId);
    const totalAvailable = available(record);
    if (totalAvailable == null) throw new Error('SRA Coin Position does not expose an available quantity.');
    const heldQuantity = this.activeHeldQuantity(parentId);
    const unencumbered = totalAvailable - heldQuantity;
    if (segmentQuantity >= unencumbered) throw new Error('Segment quantity must be less than the unencumbered parent quantity.');
    if (record.frozen || record.complianceHold || record.transferRestricted || record.disputeState === 'OPEN') {
      throw new Error('Restricted SRA Coin Positions cannot be segmented.');
    }
    const sequence = this.children(parentId).length + 1;
    const childId = deterministicChildId(parentId, sequence);
    if (this.domain.get(type, childId)) throw new Error('The proposed child SRA Coin Position already exists.');
    return {
      action: 'SRA_COIN_POSITION_SEGMENTATION_PREVIEW',
      readOnly: true,
      assetName: 'SRA Coin',
      nativeMarketPair: 'SRA/USD',
      parReference: { base: 'SRA', quote: 'USD', rate: 1 },
      parentPositionId: parentId,
      childPositionId: childId,
      positionType: type,
      participantId: ownerId(record),
      instrumentId: instrumentId(record),
      parentAvailableBefore: totalAvailable,
      heldQuantity,
      unencumberedQuantity: unencumbered,
      childQuantity: segmentQuantity,
      parentAvailableAfter: totalAvailable - segmentQuantity,
      inherited: ['OWNER', 'INSTRUMENT', 'DENOMINATION', 'VERIFIED_VALUE_LINEAGE', 'RESTRICTIONS', 'PASSPORT_HISTORY'],
      effect: 'Create one child SRA Coin Position and reduce the parent available quantity by the same amount in one atomic transition.',
      doesNot: ['CREATE_NEW_VALUE', 'CHANGE_OWNER', 'CHANGE_INSTRUMENT', 'SETTLE', 'EXPORT', 'SELF_APPROVE'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit segmentation approval is required.');
    const parentId = String(input.positionId || '').trim();
    const prior = locks.get(parentId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    locks.set(parentId, prior.then(() => current));
    await prior;
    try {
      const preview = this.preview(input);
      const { type, record: parent } = this.resolve(parentId);
      const timestamp = now();
      const parentQuantity = Number(parent.quantity ?? parent.balance ?? preview.parentAvailableBefore);
      const updatedParent = {
        ...parent,
        availableQuantity: preview.parentAvailableAfter,
        quantity: parentQuantity,
        childPositionIds: [...new Set([...(parent.childPositionIds || []), preview.childPositionId])],
        segmentationState: 'SEGMENTED',
        updatedAt: timestamp,
        statusHistory: [...(parent.statusHistory || []), { state: 'SRA_COIN_POSITION_SEGMENTED', actorId, occurredAt: timestamp, childPositionId: preview.childPositionId, quantity: preview.childQuantity }],
      };
      const child = {
        ...parent,
        coinPositionId: preview.childPositionId,
        positionId: preview.childPositionId,
        id: preview.childPositionId,
        parentPositionId: parentId,
        sourcePositionId: parentId,
        generation: Number(parent.generation || 1) + 1,
        quantity: preview.childQuantity,
        availableQuantity: preview.childQuantity,
        reservedQuantity: 0,
        externalizedQuantity: 0,
        childPositionIds: [],
        segmentationState: 'ACTIVE_CHILD',
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actorId,
        statusHistory: [{ state: 'SRA_COIN_POSITION_CHILD_CREATED', actorId, occurredAt: timestamp, parentPositionId: parentId }],
      };
      if (typeof this.domain.atomicPut !== 'function') throw new Error('Atomic SRA Coin segmentation persistence is unavailable.');
      await this.domain.atomicPut([
        { type, id: parentId, payload: updatedParent, actorId, eventType: 'SRA_COIN_POSITION_SEGMENTED' },
        { type, id: preview.childPositionId, payload: child, actorId, eventType: 'SRA_COIN_POSITION_CHILD_CREATED' },
      ]);
      return { parent: updatedParent, child, preview };
    } finally {
      release();
      if (locks.get(parentId) === current) locks.delete(parentId);
    }
  }
}
