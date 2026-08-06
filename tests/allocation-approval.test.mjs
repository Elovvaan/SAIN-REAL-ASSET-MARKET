import assert from 'node:assert/strict';
import test from 'node:test';
import { AllocationApprovalService } from '../services/allocation-approval-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }
  async put(type, id, record) { this.records.set(this.key(type, id), record); return record; }
}

test('allocation approval creates a pending buyer assignment without settlement or ownership transfer', async () => {
  const domain = new MemoryDomain();
  await domain.put('SRA_TRANSACTION', 'OMR-1', {
    transactionId: 'OMR-1', matchReviewId: 'OMR-1', transactionType: 'ORDER_MATCH_REVIEW',
    state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', allocationState: 'NOT_STARTED', settlementState: 'NOT_STARTED', ownershipTransferState: 'NOT_STARTED',
  });
  await domain.put('SRA_TRANSACTION', 'RSV-1', {
    transactionId: 'RSV-1', reservationId: 'RSV-1', transactionType: 'PRE_ALLOCATION_RESERVATION',
    matchReviewId: 'OMR-1', listingId: 'LIST-1', instrumentId: 'INS-1', buyerParticipantId: 'BUYER-1', sellerParticipantId: 'SELLER-1',
    state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', allocationState: 'NOT_STARTED', settlementState: 'NOT_STARTED', ownershipTransferState: 'NOT_STARTED',
    valueReservation: { amount: 25, currency: 'USD', state: 'HELD' },
    positionReservation: { quantity: 25, unit: 'SRA', state: 'HELD' },
    statusHistory: [],
  });

  const service = new AllocationApprovalService(domain);
  const preview = service.preview({ reservationId: 'RSV-1' });
  assert.equal(preview.pendingPosition.state, 'PROPOSED_PENDING_SETTLEMENT');
  assert.equal(preview.doesNot.includes('SETTLE_VALUE'), true);

  const allocation = await service.approve({ reservationId: 'RSV-1', approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(allocation.state, 'ALLOCATION_APPROVED_PENDING_SETTLEMENT');
  assert.equal(allocation.pendingPosition.state, 'ALLOCATED_PENDING_SETTLEMENT');
  assert.equal(allocation.settlementState, 'NOT_STARTED');
  assert.equal(allocation.ownershipTransferState, 'NOT_STARTED');

  const reservation = domain.get('SRA_TRANSACTION', 'RSV-1');
  const review = domain.get('SRA_TRANSACTION', 'OMR-1');
  assert.equal(reservation.valueReservation.state, 'HELD');
  assert.equal(reservation.positionReservation.state, 'HELD');
  assert.equal(reservation.allocationState, 'ALLOCATED_PENDING_SETTLEMENT');
  assert.equal(review.allocationState, 'ALLOCATED_PENDING_SETTLEMENT');
});

test('allocation approval rejects missing or inactive holds', async () => {
  const domain = new MemoryDomain();
  await domain.put('SRA_TRANSACTION', 'RSV-2', {
    transactionId: 'RSV-2', reservationId: 'RSV-2', transactionType: 'PRE_ALLOCATION_RESERVATION',
    state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', valueReservation: { amount: 10, state: 'HELD' }, positionReservation: { quantity: 10, state: 'RELEASED' },
  });
  const service = new AllocationApprovalService(domain);
  assert.throws(() => service.preview({ reservationId: 'RSV-2' }), /Both reservation holds must be active/);
});
