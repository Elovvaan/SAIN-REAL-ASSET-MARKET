import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderReviewMatchingService } from '../services/order-review-matching-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.failAtomic = false; }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.values()].filter((item) => item.__type === type).map(({ __type, ...item }) => item); }
  get(type, id) { const item = this.records.get(this.key(type, id)); if (!item) return null; const { __type, ...record } = item; return record; }
  async put(type, id, record) { this.records.set(this.key(type, id), { __type: type, ...record }); return record; }
  async atomicPut(changes) {
    if (this.failAtomic) throw new Error('atomic failure');
    for (const change of changes) await this.put(change.type, change.id, change.payload);
    return changes.map((change) => change.payload);
  }
}

async function seededDomain() {
  const domain = new MemoryDomain();
  await domain.put('SRA_TRANSACTION', 'OMR-1', {
    transactionId: 'OMR-1', matchReviewId: 'OMR-1', transactionType: 'ORDER_MATCH_REVIEW',
    state: 'MATCH_APPROVED_PENDING_ALLOCATION', listingId: 'LIST-1', instrumentId: 'INS-1',
    buyerParticipantId: 'BUYER-1', sellerParticipantId: 'SELLER-1', matchedQuantity: 10,
    proposedNotional: 10, quoteCurrency: 'USD', unit: 'SRA', statusHistory: [],
  });
  await domain.put('COIN_ACCOUNT', 'BAL-1', {
    coinAccountId: 'BAL-1', participantId: 'BUYER-1', currency: 'USD', availableBalance: 50,
  });
  await domain.put('COIN_POSITION', 'POS-1', {
    coinPositionId: 'POS-1', participantId: 'SELLER-1', instrumentId: 'INS-1', unit: 'SRA', availableQuantity: 20,
  });
  return domain;
}

test('approved match creates validated dual holds atomically', async () => {
  const domain = await seededDomain();
  const service = new OrderReviewMatchingService(domain);
  const preview = service.preview({ action: 'RESERVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1' });
  assert.equal(preview.valueReservation.availableBeforeHold, 50);
  assert.equal(preview.positionReservation.availableBeforeHold, 20);
  const reservation = await service.approve({ action: 'RESERVE', approval: 'APPROVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1' }, 'ADMIN-1');
  assert.equal(reservation.transactionId, 'RSV-1');
  assert.equal(reservation.valueReservation.state, 'HELD');
  assert.equal(reservation.positionReservation.state, 'HELD');
  assert.equal(domain.get('SRA_TRANSACTION', 'OMR-1').reservationId, 'RSV-1');
});

test('rejects nonexistent, wrong-owner, wrong-instrument, and insufficient sources', async () => {
  const domain = await seededDomain();
  const service = new OrderReviewMatchingService(domain);
  assert.throws(() => service.preview({ action: 'RESERVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'MISSING', sellerPositionId: 'POS-1' }), /not found/);
  await domain.put('COIN_ACCOUNT', 'BAL-2', { coinAccountId: 'BAL-2', participantId: 'OTHER', currency: 'USD', availableBalance: 50 });
  assert.throws(() => service.preview({ action: 'RESERVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-2', sellerPositionId: 'POS-1' }), /not owned by the matched buyer/);
  await domain.put('COIN_POSITION', 'POS-2', { coinPositionId: 'POS-2', participantId: 'SELLER-1', instrumentId: 'INS-OTHER', unit: 'SRA', availableQuantity: 20 });
  assert.throws(() => service.preview({ action: 'RESERVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-2' }), /does not represent the matched instrument/);
  await domain.put('COIN_POSITION', 'POS-3', { coinPositionId: 'POS-3', participantId: 'SELLER-1', instrumentId: 'INS-1', unit: 'SRA', availableQuantity: 5 });
  assert.throws(() => service.preview({ action: 'RESERVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-3' }), /insufficient available quantity/);
});

test('existing holds reduce availability and duplicate approvals cannot create another reservation', async () => {
  const domain = await seededDomain();
  await domain.put('SRA_TRANSACTION', 'RSV-OLD', {
    transactionId: 'RSV-OLD', transactionType: 'PRE_ALLOCATION_RESERVATION', state: 'RESERVED_PENDING_ALLOCATION_APPROVAL',
    buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1', valueReservation: { amount: 45 }, positionReservation: { quantity: 15 },
  });
  const service = new OrderReviewMatchingService(domain);
  assert.throws(() => service.preview({ action: 'RESERVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1' }), /insufficient available value/);

  const clean = await seededDomain();
  const cleanService = new OrderReviewMatchingService(clean);
  await cleanService.approve({ action: 'RESERVE', approval: 'APPROVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1' }, 'ADMIN-1');
  await assert.rejects(() => cleanService.approve({ action: 'RESERVE', approval: 'APPROVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1' }, 'ADMIN-1'), /already has a reservation|not awaiting reservation/);
  assert.equal(clean.list('SRA_TRANSACTION').filter((item) => item.transactionType === 'PRE_ALLOCATION_RESERVATION').length, 1);
});

test('atomic failure leaves neither reservation nor review transition', async () => {
  const domain = await seededDomain();
  domain.failAtomic = true;
  const service = new OrderReviewMatchingService(domain);
  await assert.rejects(() => service.approve({ action: 'RESERVE', approval: 'APPROVE', matchReviewId: 'OMR-1', buyerReservationSourceId: 'BAL-1', sellerPositionId: 'POS-1' }, 'ADMIN-1'), /atomic failure/);
  assert.equal(domain.get('SRA_TRANSACTION', 'RSV-1'), null);
  assert.equal(domain.get('SRA_TRANSACTION', 'OMR-1').state, 'MATCH_APPROVED_PENDING_ALLOCATION');
});
