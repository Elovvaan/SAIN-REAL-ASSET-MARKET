import assert from 'node:assert/strict';
import test from 'node:test';
import { ParticipantOrderIntentService } from '../services/participant-order-intent-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }
  async put(type, id, record) { this.records.set(this.key(type, id), record); return record; }
  async lifecycle() {}
}

function liveListing() {
  return {
    listingId: 'LIST-1', instrumentId: 'INS-1', state: 'PUBLISHED', status: 'LIVE', quantity: 100,
    unit: 'SRA', pricing: { askingPrice: 1, currency: 'USD' },
  };
}

test('preview explains a non-executing order intent', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'LIST-1', liveListing());
  const service = new ParticipantOrderIntentService(domain);
  const preview = service.preview({ listingId: 'LIST-1', side: 'BUY', orderType: 'MARKET', quantity: 12 }, 'P-1');
  assert.equal(preview.estimatedNotional, 12);
  assert.equal(preview.confirmationRequired, true);
  assert.ok(preview.doesNot.includes('SETTLE_VALUE'));
  assert.equal(domain.list('SRA_TRANSACTION').length, 0);
});

test('confirmation persists a queued canonical transaction without execution', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'LIST-1', liveListing());
  const service = new ParticipantOrderIntentService(domain);
  const record = await service.confirm({ listingId: 'LIST-1', side: 'SELL', orderType: 'LIMIT', quantity: 5, limitPrice: 1.1, confirmation: 'CONFIRM' }, 'P-1');
  assert.equal(record.transactionType, 'PARTICIPANT_ORDER_INTENT');
  assert.equal(record.state, 'QUEUED_FOR_ORDER_REVIEW');
  assert.equal(record.matchingState, 'NOT_STARTED');
  assert.equal(record.settlementState, 'NOT_STARTED');
  assert.equal(service.listForParticipant('P-1').length, 1);
});

test('prepared listings and unconfirmed requests are rejected', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'LIST-2', { ...liveListing(), listingId: 'LIST-2', state: 'PREPARED', status: 'READY_FOR_PUBLICATION_APPROVAL' });
  const service = new ParticipantOrderIntentService(domain);
  assert.throws(() => service.preview({ listingId: 'LIST-2', side: 'BUY', quantity: 1 }), /Only LIVE/);
  await domain.put('MARKETPLACE_LISTING', 'LIST-1', liveListing());
  await assert.rejects(() => service.confirm({ listingId: 'LIST-1', side: 'BUY', quantity: 1 }, 'P-1'), /confirmation/);
});
