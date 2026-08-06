import assert from 'node:assert/strict';
import test from 'node:test';
import { SettlementAuthorizationService } from '../services/settlement-authorization-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.failAtomic = false; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, record) { this.records.set(this.key(type, id), structuredClone(record)); return record; }
  async atomicPut(changes) {
    if (this.failAtomic) throw new Error('atomic failure');
    for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload));
    return changes.map((change) => change.payload);
  }
}

async function seed(domain) {
  await domain.put('COIN_ACCOUNT', 'BUY-CASH', { coinAccountId: 'BUY-CASH', participantId: 'BUYER-1', currency: 'USD', availableBalance: 100 });
  await domain.put('COIN_ACCOUNT', 'SELL-CASH', { coinAccountId: 'SELL-CASH', participantId: 'SELLER-1', currency: 'USD', availableBalance: 20 });
  await domain.put('COIN_POSITION', 'SELL-POS', { coinPositionId: 'SELL-POS', participantId: 'SELLER-1', instrumentId: 'INS-1', unit: 'SRA', availableQuantity: 50 });
  await domain.put('SRA_TRANSACTION', 'OMR-1', { transactionId: 'OMR-1', matchReviewId: 'OMR-1', transactionType: 'ORDER_MATCH_REVIEW', allocationId: 'ALC-1', state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT', settlementState: 'NOT_STARTED' });
  await domain.put('SRA_TRANSACTION', 'RSV-1', {
    transactionId: 'RSV-1', reservationId: 'RSV-1', transactionType: 'PRE_ALLOCATION_RESERVATION', allocationId: 'ALC-1', matchReviewId: 'OMR-1',
    listingId: 'LIST-1', instrumentId: 'INS-1', buyerParticipantId: 'BUYER-1', sellerParticipantId: 'SELLER-1',
    buyerReservationSourceId: 'BUY-CASH', buyerReservationSourceType: 'COIN_ACCOUNT', sellerPositionId: 'SELL-POS', sellerPositionType: 'COIN_POSITION',
    valueReservation: { amount: 30, currency: 'USD', state: 'HELD' }, positionReservation: { quantity: 30, unit: 'SRA', state: 'HELD' },
    state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT', settlementState: 'NOT_STARTED', statusHistory: []
  });
  await domain.put('SRA_TRANSACTION', 'ALC-1', {
    transactionId: 'ALC-1', allocationId: 'ALC-1', transactionType: 'POSITION_ALLOCATION_APPROVAL', reservationId: 'RSV-1', matchReviewId: 'OMR-1',
    listingId: 'LIST-1', instrumentId: 'INS-1', buyerParticipantId: 'BUYER-1', sellerParticipantId: 'SELLER-1',
    pendingPosition: { participantId: 'BUYER-1', quantity: 30, unit: 'SRA', state: 'ALLOCATED_PENDING_SETTLEMENT' },
    state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT', allocationState: 'ALLOCATED_PENDING_SETTLEMENT', settlementState: 'NOT_STARTED', statusHistory: []
  });
}

test('settlement atomically moves value and position and recognizes buyer ownership', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  const service = new SettlementAuthorizationService(domain);
  const preview = service.preview({ allocationId: 'ALC-1', sellerSettlementDestinationId: 'SELL-CASH' });
  assert.equal(preview.amount, 30);
  assert.equal(preview.quantity, 30);
  const result = await service.approve({ allocationId: 'ALC-1', sellerSettlementDestinationId: 'SELL-CASH', approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(result.state, 'SETTLED');
  assert.equal(domain.get('COIN_ACCOUNT', 'BUY-CASH').availableBalance, 70);
  assert.equal(domain.get('COIN_ACCOUNT', 'SELL-CASH').availableBalance, 50);
  assert.equal(domain.get('COIN_POSITION', 'SELL-POS').availableQuantity, 20);
  assert.equal(domain.get('COIN_POSITION', 'CP-1').availableQuantity, 30);
  assert.equal(domain.get('OWNERSHIP_RECOGNITION', 'OWN-1').state, 'RECOGNIZED');
  assert.equal(domain.get('SRA_TRANSACTION', 'RSV-1').valueReservation.state, 'CONSUMED');
});

test('settlement rejects duplicate completion and changed backing records', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  const service = new SettlementAuthorizationService(domain);
  await service.approve({ allocationId: 'ALC-1', sellerSettlementDestinationId: 'SELL-CASH', approval: 'APPROVE' }, 'ADMIN-1');
  await assert.rejects(() => service.approve({ allocationId: 'ALC-1', sellerSettlementDestinationId: 'SELL-CASH', approval: 'APPROVE' }, 'ADMIN-1'), /not awaiting settlement|already been settled/);

  const second = new MemoryDomain();
  await seed(second);
  await second.put('COIN_POSITION', 'SELL-POS', { coinPositionId: 'SELL-POS', participantId: 'SELLER-1', instrumentId: 'INS-1', unit: 'SRA', availableQuantity: 5 });
  assert.throws(() => new SettlementAuthorizationService(second).preview({ allocationId: 'ALC-1', sellerSettlementDestinationId: 'SELL-CASH' }), /no longer covers/);
});

test('atomic failure leaves every source and lifecycle record unchanged', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  domain.failAtomic = true;
  const service = new SettlementAuthorizationService(domain);
  await assert.rejects(() => service.approve({ allocationId: 'ALC-1', sellerSettlementDestinationId: 'SELL-CASH', approval: 'APPROVE' }, 'ADMIN-1'), /atomic failure/);
  assert.equal(domain.get('COIN_ACCOUNT', 'BUY-CASH').availableBalance, 100);
  assert.equal(domain.get('COIN_ACCOUNT', 'SELL-CASH').availableBalance, 20);
  assert.equal(domain.get('COIN_POSITION', 'SELL-POS').availableQuantity, 50);
  assert.equal(domain.get('SRA_TRANSACTION', 'ALC-1').state, 'ALLOCATION_APPROVED_PENDING_SETTLEMENT');
  assert.equal(domain.get('SRA_TRANSACTION', 'STL-1'), null);
});
