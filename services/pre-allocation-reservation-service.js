import crypto from 'node:crypto';

const TRANSACTION_TYPE = 'SRA_TRANSACTION';

function now() { return new Date().toISOString(); }
function id() { return `RSV-${crypto.randomUUID().toUpperCase()}`; }
function positive(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${field} must be greater than zero.`);
  return result;
}

export class PreAllocationReservationService {
  constructor(domain) { this.domain = domain; }

  matchReview(matchReviewId) {
    const review = this.domain.get(TRANSACTION_TYPE, matchReviewId);
    if (!review || review.transactionType !== 'ORDER_MATCH_REVIEW') throw new Error('Approved order match was not found.');
    if (review.state !== 'MATCH_APPROVED_PENDING_ALLOCATION') throw new Error('Order match is not awaiting reservation.');
    return review;
  }

  preview(input = {}) {
    const review = this.matchReview(String(input.matchReviewId || '').trim());
    const buyerReservationSourceId = String(input.buyerReservationSourceId || '').trim();
    const sellerPositionId = String(input.sellerPositionId || '').trim();
    if (!buyerReservationSourceId) throw new Error('buyerReservationSourceId is required.');
    if (!sellerPositionId) throw new Error('sellerPositionId is required.');
    const quantity = positive(review.matchedQuantity, 'matchedQuantity');
    const valueAmount = positive(review.proposedNotional, 'proposedNotional');
    return {
      action: 'PRE_ALLOCATION_RESERVATION_PREVIEW',
      readOnly: true,
      matchReviewId: review.matchReviewId || review.transactionId,
      listingId: review.listingId,
      instrumentId: review.instrumentId,
      buyerParticipantId: review.buyerParticipantId,
      sellerParticipantId: review.sellerParticipantId,
      buyerReservationSourceId,
      sellerPositionId,
      valueReservation: { amount: valueAmount, currency: review.quoteCurrency || 'USD', state: 'PROPOSED' },
      positionReservation: { quantity, unit: review.unit || 'SRA', state: 'PROPOSED' },
      effect: 'Create protected buyer-value and seller-position holds for a previously approved match.',
      doesNot: ['DEBIT_BALANCE', 'CREDIT_BALANCE', 'ALLOCATE_POSITION', 'SETTLE_VALUE', 'TRANSFER_OWNERSHIP', 'CREATE_EXPORT_PACKAGE'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit reservation approval is required.');
    const preview = this.preview(input);
    const createdAt = now();
    const reservationId = id();
    const reservation = {
      transactionId: reservationId,
      reservationId,
      transactionType: 'PRE_ALLOCATION_RESERVATION',
      matchReviewId: preview.matchReviewId,
      listingId: preview.listingId,
      instrumentId: preview.instrumentId,
      buyerParticipantId: preview.buyerParticipantId,
      sellerParticipantId: preview.sellerParticipantId,
      buyerReservationSourceId: preview.buyerReservationSourceId,
      sellerPositionId: preview.sellerPositionId,
      valueReservation: { ...preview.valueReservation, state: 'HELD' },
      positionReservation: { ...preview.positionReservation, state: 'HELD' },
      state: 'RESERVED_PENDING_ALLOCATION_APPROVAL',
      allocationState: 'NOT_STARTED',
      settlementState: 'NOT_STARTED',
      ownershipTransferState: 'NOT_STARTED',
      approvedBy: actorId,
      approvedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      statusHistory: [{ state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', actorId, occurredAt: createdAt }],
    };
    await this.domain.put(TRANSACTION_TYPE, reservationId, reservation, { actorId, eventType: 'PRE_ALLOCATION_RESERVATION_APPROVED' });
    const review = this.matchReview(preview.matchReviewId);
    await this.domain.put(TRANSACTION_TYPE, review.transactionId || review.matchReviewId, {
      ...review,
      state: 'RESERVED_PENDING_ALLOCATION_APPROVAL',
      reservationId,
      reservationState: 'HELD',
      updatedAt: createdAt,
    }, { actorId, eventType: 'ORDER_MATCH_RESERVATION_HELD' });
    return reservation;
  }

  list() {
    return this.domain.list(TRANSACTION_TYPE)
      .filter((item) => item.transactionType === 'PRE_ALLOCATION_RESERVATION')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  status() {
    const reservations = this.list();
    return {
      reservationCount: reservations.length,
      held: reservations.filter((item) => item.state === 'RESERVED_PENDING_ALLOCATION_APPROVAL').length,
      allocated: reservations.filter((item) => item.allocationState === 'ALLOCATED').length,
      settled: reservations.filter((item) => item.settlementState === 'SETTLED').length,
      latestReservation: reservations[0] || null,
    };
  }
}
