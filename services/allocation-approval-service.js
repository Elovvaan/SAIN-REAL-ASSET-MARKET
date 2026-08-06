import crypto from 'node:crypto';

const TRANSACTION_TYPE = 'SRA_TRANSACTION';
function now() { return new Date().toISOString(); }
function id() { return `ALC-${crypto.randomUUID().toUpperCase()}`; }

export class AllocationApprovalService {
  constructor(domain) { this.domain = domain; }

  reservation(reservationId) {
    const reservation = this.domain.get(TRANSACTION_TYPE, reservationId);
    if (!reservation || reservation.transactionType !== 'PRE_ALLOCATION_RESERVATION') throw new Error('Pre-allocation reservation was not found.');
    if (reservation.state !== 'RESERVED_PENDING_ALLOCATION_APPROVAL') throw new Error('Reservation is not awaiting allocation approval.');
    if (reservation.valueReservation?.state !== 'HELD' || reservation.positionReservation?.state !== 'HELD') throw new Error('Both reservation holds must be active before allocation approval.');
    return reservation;
  }

  preview(input = {}) {
    const reservation = this.reservation(String(input.reservationId || '').trim());
    return {
      action: 'ALLOCATION_APPROVAL_PREVIEW',
      readOnly: true,
      reservationId: reservation.reservationId || reservation.transactionId,
      matchReviewId: reservation.matchReviewId,
      listingId: reservation.listingId,
      instrumentId: reservation.instrumentId,
      buyerParticipantId: reservation.buyerParticipantId,
      sellerParticipantId: reservation.sellerParticipantId,
      pendingPosition: {
        participantId: reservation.buyerParticipantId,
        quantity: Number(reservation.positionReservation.quantity),
        unit: reservation.positionReservation.unit || 'SRA',
        state: 'PROPOSED_PENDING_SETTLEMENT',
      },
      reservedValue: { ...reservation.valueReservation },
      effect: 'Approve a pending buyer position assignment while both reservation holds remain active until settlement.',
      doesNot: ['DEBIT_BALANCE', 'CREDIT_BALANCE', 'RELEASE_HOLDS', 'SETTLE_VALUE', 'TRANSFER_FINAL_OWNERSHIP', 'CREATE_EXPORT_PACKAGE'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit allocation approval is required.');
    const preview = this.preview(input);
    const approvedAt = now();
    const allocationId = id();
    const allocation = {
      transactionId: allocationId,
      allocationId,
      transactionType: 'POSITION_ALLOCATION_APPROVAL',
      reservationId: preview.reservationId,
      matchReviewId: preview.matchReviewId,
      listingId: preview.listingId,
      instrumentId: preview.instrumentId,
      buyerParticipantId: preview.buyerParticipantId,
      sellerParticipantId: preview.sellerParticipantId,
      pendingPosition: { ...preview.pendingPosition, state: 'ALLOCATED_PENDING_SETTLEMENT' },
      reservedValue: preview.reservedValue,
      state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT',
      allocationState: 'ALLOCATED_PENDING_SETTLEMENT',
      settlementState: 'NOT_STARTED',
      ownershipTransferState: 'NOT_STARTED',
      approvedBy: actorId,
      approvedAt,
      createdAt: approvedAt,
      updatedAt: approvedAt,
      statusHistory: [{ state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT', actorId, occurredAt: approvedAt }],
    };
    await this.domain.put(TRANSACTION_TYPE, allocationId, allocation, { actorId, eventType: 'POSITION_ALLOCATION_APPROVED' });

    const reservation = this.reservation(preview.reservationId);
    await this.domain.put(TRANSACTION_TYPE, reservation.transactionId || reservation.reservationId, {
      ...reservation,
      state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT',
      allocationId,
      allocationState: 'ALLOCATED_PENDING_SETTLEMENT',
      updatedAt: approvedAt,
      statusHistory: [...(reservation.statusHistory || []), { state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT', actorId, occurredAt: approvedAt }],
    }, { actorId, eventType: 'PRE_ALLOCATION_RESERVATION_ALLOCATED' });

    const review = this.domain.get(TRANSACTION_TYPE, preview.matchReviewId);
    if (review?.transactionType === 'ORDER_MATCH_REVIEW') {
      await this.domain.put(TRANSACTION_TYPE, review.transactionId || review.matchReviewId, {
        ...review,
        state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT',
        allocationId,
        allocationState: 'ALLOCATED_PENDING_SETTLEMENT',
        updatedAt: approvedAt,
      }, { actorId, eventType: 'ORDER_MATCH_ALLOCATION_APPROVED' });
    }
    return allocation;
  }

  list() {
    return this.domain.list(TRANSACTION_TYPE)
      .filter((item) => item.transactionType === 'POSITION_ALLOCATION_APPROVAL')
      .sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)));
  }

  status() {
    const allocations = this.list();
    return {
      allocationApprovalCount: allocations.length,
      pendingSettlement: allocations.filter((item) => item.state === 'ALLOCATION_APPROVED_PENDING_SETTLEMENT').length,
      settled: allocations.filter((item) => item.settlementState === 'SETTLED').length,
      latestAllocation: allocations[0] || null,
    };
  }
}
