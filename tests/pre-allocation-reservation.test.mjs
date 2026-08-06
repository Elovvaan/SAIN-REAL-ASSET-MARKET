import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderReviewMatchingService } from '../services/order-review-matching-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.values()].filter((item) => item.__type === type).map(({ __type, ...item }) => item); }
  get(type, id) { const item = this.records.get(this.key(type, id)); if (!item) return null; const { __type, ...record } = item; return record; }
  async put(type, id, record) { this.records.set(this.key(type, id), { __type: type, ...record }); return record; }
}

test('approved match can create protected buyer and seller holds without allocation or settlement', async () => {
  const domain = new MemoryDomain();
  await domain.put('SRA_TRANSACTION', 'OMR-1', {
    transactionId: 'OMR-1', matchReviewId: 'OMR-1', transactionType: 'ORDER_MATCH_REVIEW',
    state: 'MATCH_APPROVED_PENDING_ALLOCATION', listingId: 'LIST-1', instrumentId: 'INS-1',
    buyerParticipantId: 'BUYER-1', sellerParticipantId: 'SELLER-1', matchedQuantity: 10,
    proposedNotional: 10, quoteCurrency: 'USD', unit: 'SRA'
  });
  const service = new OrderReviewMatchingService(domain);
  const preview = service.preview({ action: 'RESERVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1' });
  assert.equal(preview.valueReservation.amount, 10);
  assert.equal(preview.positionReservation.quantity, 10);
  const reservation = await service.approve({ action: 'RESERVE', approval: 'APPROVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1' }, 'ADMIN-1');
  assert.equal(reservation.state, 'RESERVED_PENDING_ALLOCATION_APPROVAL');
  assert.equal(reservation.valueReservation.state, 'HELD');
  assert.equal(reservation.positionReservation.state, 'HELD');
  assert.equal(reservation.allocationState, 'NOT_STARTED');
  assert.equal(reservation.settlementState, 'NOT_STARTED');
  assert.equal(reservation.ownershipTransferState, 'NOT_STARTED');
  assert.equal(domain.get('SRA_TRANSACTION', 'OMR-1').reservationState, 'HELD');
});
