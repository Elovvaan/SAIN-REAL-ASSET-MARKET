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

async function seed(domain) {
  await domain.put('MARKETPLACE_LISTING', 'LIST-1', { listingId: 'LIST-1', instrumentId: 'INS-1', state: 'PUBLISHED', status: 'LIVE' });
  await domain.put('SRA_TRANSACTION', 'BUY-1', {
    transactionId: 'BUY-1', orderIntentId: 'BUY-1', transactionType: 'PARTICIPANT_ORDER_INTENT', participantId: 'P-BUY',
    listingId: 'LIST-1', instrumentId: 'INS-1', side: 'BUY', orderType: 'LIMIT', quantity: 10, unit: 'SRA', unitPrice: 1.02,
    state: 'QUEUED_FOR_ORDER_REVIEW', matchingState: 'NOT_STARTED', createdAt: '2026-08-05T20:00:00Z', statusHistory: [],
  });
  await domain.put('SRA_TRANSACTION', 'SELL-1', {
    transactionId: 'SELL-1', orderIntentId: 'SELL-1', transactionType: 'PARTICIPANT_ORDER_INTENT', participantId: 'P-SELL',
    listingId: 'LIST-1', instrumentId: 'INS-1', side: 'SELL', orderType: 'LIMIT', quantity: 7, unit: 'SRA', unitPrice: 1,
    state: 'QUEUED_FOR_ORDER_REVIEW', matchingState: 'NOT_STARTED', createdAt: '2026-08-05T20:01:00Z', statusHistory: [],
  });
}

test('proposes a compatible match without allocation or settlement', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  const service = new OrderReviewMatchingService(domain);
  const preview = service.preview({ listingId: 'LIST-1' });
  assert.equal(preview.matchPossible, true);
  assert.equal(preview.matchedQuantity, 7);
  assert.equal(preview.matchPrice, 1.01);
  assert.ok(preview.doesNot.includes('SETTLE_VALUE'));
  assert.equal(domain.list('SRA_TRANSACTION').length, 2);
});

test('approval records canonical transaction review and does not allocate or settle', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  const service = new OrderReviewMatchingService(domain);
  const review = await service.approve({ listingId: 'LIST-1', approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(review.transactionType, 'ORDER_MATCH_REVIEW');
  assert.equal(review.state, 'MATCH_APPROVED_PENDING_ALLOCATION');
  assert.equal(review.allocationState, 'NOT_STARTED');
  assert.equal(review.settlementState, 'NOT_STARTED');
  assert.equal(domain.get('SRA_TRANSACTION', 'BUY-1').matchingState, 'MATCH_APPROVED');
  assert.equal(domain.get('SRA_TRANSACTION', 'SELL-1').matchingState, 'MATCH_APPROVED');
  assert.equal(service.status().pendingAllocationCount, 1);
});

test('does not propose a match when bid and ask do not cross', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  const sell = domain.get('SRA_TRANSACTION', 'SELL-1');
  await domain.put('SRA_TRANSACTION', 'SELL-1', { ...sell, unitPrice: 1.10 });
  const preview = new OrderReviewMatchingService(domain).preview({ listingId: 'LIST-1' });
  assert.equal(preview.matchPossible, false);
  assert.equal(preview.state, 'PRICE_NOT_CROSSED');
});
