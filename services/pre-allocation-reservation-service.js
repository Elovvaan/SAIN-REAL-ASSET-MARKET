const TRANSACTION_TYPE = 'SRA_TRANSACTION';
const BUYER_SOURCE_TYPES = ['COIN_ACCOUNT', 'COIN_POSITION', 'PARTICIPATION_POSITION', 'TRANSFERABLE_POSITION'];
const SELLER_POSITION_TYPES = ['COIN_POSITION', 'PARTICIPATION_POSITION', 'TRANSFERABLE_POSITION'];
const approvalLocks = new Map();

function now() { return new Date().toISOString(); }
function reservationId(matchReviewId) { return `RSV-${String(matchReviewId).replace(/^OMR-/, '')}`; }
function positive(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${field} must be greater than zero.`);
  return result;
}
function firstNumber(record, fields) {
  for (const field of fields) {
    const value = field.split('.').reduce((current, part) => current?.[part], record);
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}
function ownerId(record) {
  return record?.participantId || record?.ownerParticipantId || record?.ownerId || record?.accountHolderId || record?.holderId || null;
}
function denomination(record) {
  return String(record?.currency || record?.quoteCurrency || record?.unit || record?.symbol || record?.denomination?.symbol || '').toUpperCase();
}
function instrumentId(record) {
  return record?.instrumentId || record?.linkedInstrumentId || record?.underlyingInstrumentId || null;
}

export class PreAllocationReservationService {
  constructor(domain) { this.domain = domain; }

  matchReview(matchReviewId) {
    const review = this.domain.get(TRANSACTION_TYPE, matchReviewId);
    if (!review || review.transactionType !== 'ORDER_MATCH_REVIEW') throw new Error('Approved order match was not found.');
    if (review.state !== 'MATCH_APPROVED_PENDING_ALLOCATION') throw new Error('Order match is not awaiting reservation.');
    if (review.reservationId) throw new Error('Order match already has a reservation.');
    return review;
  }

  resolve(typeCandidates, id, label) {
    for (const type of typeCandidates) {
      const record = this.domain.get(type, id);
      if (record) return { type, record };
    }
    throw new Error(`${label} was not found.`);
  }

  activeReservations() {
    return this.domain.list(TRANSACTION_TYPE).filter((item) => item.transactionType === 'PRE_ALLOCATION_RESERVATION'
      && ['RESERVED_PENDING_ALLOCATION_APPROVAL', 'ALLOCATION_APPROVED_PENDING_SETTLEMENT'].includes(item.state));
  }

  validateBuyerSource(review, sourceId, requiredAmount) {
    const source = this.resolve(BUYER_SOURCE_TYPES, sourceId, 'Buyer reservation source');
    const owner = ownerId(source.record);
    if (!owner || owner !== review.buyerParticipantId) throw new Error('Buyer reservation source is not owned by the matched buyer.');
    const currency = denomination(source.record);
    const isUsd = currency === 'USD';
    const isParSra = currency === 'SRA' && (source.record.pricingPolicy === 'FIXED_PAR' || source.record.parValue === 1 || source.record.unitPrice === 1);
    if (!isUsd && !isParSra) throw new Error('Buyer reservation source must be denominated in USD or fixed-par SRA.');
    const total = firstNumber(source.record, ['availableBalance', 'availableAmount', 'spendableBalance', 'balance.available', 'balance', 'quantityAvailable', 'availableQuantity', 'quantity']);
    if (total == null) throw new Error('Buyer reservation source does not expose an available balance.');
    const alreadyHeld = this.activeReservations()
      .filter((item) => item.buyerReservationSourceId === sourceId)
      .reduce((sum, item) => sum + Number(item.valueReservation?.amount || 0), 0);
    const available = total - alreadyHeld;
    if (available < requiredAmount) throw new Error('Buyer reservation source has insufficient available value after existing holds.');
    return { ...source, owner, currency, total, alreadyHeld, available };
  }

  validateSellerPosition(review, positionId, requiredQuantity) {
    const position = this.resolve(SELLER_POSITION_TYPES, positionId, 'Seller position');
    const owner = ownerId(position.record);
    if (!owner || owner !== review.sellerParticipantId) throw new Error('Seller position is not owned by the matched seller.');
    const linkedInstrumentId = instrumentId(position.record);
    if (!linkedInstrumentId || linkedInstrumentId !== review.instrumentId) throw new Error('Seller position does not represent the matched instrument.');
    const unit = denomination(position.record);
    if (unit && unit !== 'SRA') throw new Error('Seller position must be denominated in SRA.');
    const total = firstNumber(position.record, ['availableQuantity', 'quantityAvailable', 'transferableQuantity', 'balance.available', 'quantity', 'balance']);
    if (total == null) throw new Error('Seller position does not expose an available quantity.');
    const alreadyHeld = this.activeReservations()
      .filter((item) => item.sellerPositionId === positionId)
      .reduce((sum, item) => sum + Number(item.positionReservation?.quantity || 0), 0);
    const available = total - alreadyHeld;
    if (available < requiredQuantity) throw new Error('Seller position has insufficient available quantity after existing holds.');
    return { ...position, owner, unit: unit || 'SRA', total, alreadyHeld, available };
  }

  preview(input = {}) {
    const review = this.matchReview(String(input.matchReviewId || '').trim());
    const buyerReservationSourceId = String(input.buyerReservationSourceId || '').trim();
    const sellerPositionId = String(input.sellerPositionId || '').trim();
    if (!buyerReservationSourceId) throw new Error('buyerReservationSourceId is required.');
    if (!sellerPositionId) throw new Error('sellerPositionId is required.');
    const quantity = positive(review.matchedQuantity, 'matchedQuantity');
    const valueAmount = positive(review.proposedNotional, 'proposedNotional');
    const buyerSource = this.validateBuyerSource(review, buyerReservationSourceId, valueAmount);
    const sellerPosition = this.validateSellerPosition(review, sellerPositionId, quantity);
    return {
      action: 'PRE_ALLOCATION_RESERVATION_PREVIEW', readOnly: true,
      matchReviewId: review.matchReviewId || review.transactionId,
      listingId: review.listingId, instrumentId: review.instrumentId,
      buyerParticipantId: review.buyerParticipantId, sellerParticipantId: review.sellerParticipantId,
      buyerReservationSourceId, buyerReservationSourceType: buyerSource.type,
      sellerPositionId, sellerPositionType: sellerPosition.type,
      valueReservation: { amount: valueAmount, currency: review.quoteCurrency || 'USD', state: 'PROPOSED', availableBeforeHold: buyerSource.available },
      positionReservation: { quantity, unit: review.unit || 'SRA', state: 'PROPOSED', availableBeforeHold: sellerPosition.available },
      effect: 'Atomically claim the approved match and create validated buyer-value and seller-position holds.',
      doesNot: ['DEBIT_BALANCE', 'CREDIT_BALANCE', 'ALLOCATE_POSITION', 'SETTLE_VALUE', 'TRANSFER_OWNERSHIP', 'CREATE_EXPORT_PACKAGE'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit reservation approval is required.');
    const matchReviewId = String(input.matchReviewId || '').trim();
    if (!matchReviewId) throw new Error('matchReviewId is required.');
    const prior = approvalLocks.get(matchReviewId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    approvalLocks.set(matchReviewId, prior.then(() => current));
    await prior;
    try {
      const deterministicId = reservationId(matchReviewId);
      const existing = this.domain.get(TRANSACTION_TYPE, deterministicId);
      if (existing) throw new Error('Order match already has a reservation.');
      const preview = this.preview(input);
      const createdAt = now();
      const reservation = {
        transactionId: deterministicId, reservationId: deterministicId, transactionType: 'PRE_ALLOCATION_RESERVATION',
        matchReviewId: preview.matchReviewId, listingId: preview.listingId, instrumentId: preview.instrumentId,
        buyerParticipantId: preview.buyerParticipantId, sellerParticipantId: preview.sellerParticipantId,
        buyerReservationSourceId: preview.buyerReservationSourceId, buyerReservationSourceType: preview.buyerReservationSourceType,
        sellerPositionId: preview.sellerPositionId, sellerPositionType: preview.sellerPositionType,
        valueReservation: { ...preview.valueReservation, state: 'HELD' },
        positionReservation: { ...preview.positionReservation, state: 'HELD' },
        state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', allocationState: 'NOT_STARTED', settlementState: 'NOT_STARTED', ownershipTransferState: 'NOT_STARTED',
        approvedBy: actorId, approvedAt: createdAt, createdAt, updatedAt: createdAt,
        statusHistory: [{ state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', actorId, occurredAt: createdAt }],
      };
      const review = this.matchReview(preview.matchReviewId);
      const updatedReview = {
        ...review, state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', reservationId: deterministicId, reservationState: 'HELD', updatedAt: createdAt,
        statusHistory: [...(review.statusHistory || []), { state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', actorId, occurredAt: createdAt }],
      };
      if (typeof this.domain.atomicPut !== 'function') throw new Error('Atomic reservation persistence is unavailable.');
      await this.domain.atomicPut([
        { type: TRANSACTION_TYPE, id: deterministicId, payload: reservation, actorId, eventType: 'PRE_ALLOCATION_RESERVATION_APPROVED' },
        { type: TRANSACTION_TYPE, id: review.transactionId || review.matchReviewId, payload: updatedReview, actorId, eventType: 'ORDER_MATCH_RESERVATION_HELD' },
      ]);
      return reservation;
    } finally {
      release();
      if (approvalLocks.get(matchReviewId) === current) approvalLocks.delete(matchReviewId);
    }
  }

  list() {
    return this.domain.list(TRANSACTION_TYPE).filter((item) => item.transactionType === 'PRE_ALLOCATION_RESERVATION')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  status() {
    const reservations = this.list();
    return {
      reservationCount: reservations.length,
      held: reservations.filter((item) => item.state === 'RESERVED_PENDING_ALLOCATION_APPROVAL').length,
      allocated: reservations.filter((item) => item.allocationState === 'ALLOCATED_PENDING_SETTLEMENT').length,
      settled: reservations.filter((item) => item.settlementState === 'SETTLED').length,
      latestReservation: reservations[0] || null,
    };
  }
}
