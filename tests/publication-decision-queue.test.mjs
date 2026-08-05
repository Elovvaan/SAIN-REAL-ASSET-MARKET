import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicationDecisionQueueService } from '../services/publication-decision-queue-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  async put(type, id, value) { this.records.set(this.key(type, id), structuredClone(value)); return value; }
  async lifecycle() {}
}

function readyListing(id, quantity = 10, price = 1) {
  return {
    listingId: id,
    instrumentId: `INS-${id}`,
    state: 'PREPARED',
    status: 'READY_FOR_PUBLICATION_APPROVAL',
    blockers: [],
    quantity,
    pricing: { askingPrice: price, currency: 'USD' },
    access: { state: 'CONFIGURED' },
    transactionRouteId: 'SRA_INTERNAL_MARKETPLACE',
    settlementRouteId: 'SRA_INTERNAL_SETTLEMENT',
    readinessBatchId: 'LRB-1',
    readinessApprovedAt: '2026-08-05T20:00:00.000Z',
  };
}

test('publication queue explains the exact valid set and protected boundary', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'LIST-1', readyListing('LIST-1', 20, 1));
  await domain.put('MARKETPLACE_LISTING', 'LIST-2', readyListing('LIST-2', 30, 1));
  const service = new PublicationDecisionQueueService(domain);
  const queue = service.explain();
  assert.equal(queue.queueState, 'PUBLICATION_DECISION_REQUIRED');
  assert.equal(queue.eligibleListingCount, 2);
  assert.equal(queue.totalQuantity, 50);
  assert.equal(queue.totalIndicativeValue, 50);
  assert.equal(queue.approval.required, true);
  assert.ok(queue.doesNot.includes('SETTLE_VALUE'));
});

test('publication approval moves only the valid queue to live inventory', async () => {
  const domain = new MemoryDomain();
  await domain.put('MARKETPLACE_LISTING', 'LIST-1', readyListing('LIST-1'));
  await domain.put('MARKETPLACE_LISTING', 'LIST-BLOCKED', { ...readyListing('LIST-BLOCKED'), blockers: ['SETTLEMENT_ROUTE_REQUIRED'] });
  const service = new PublicationDecisionQueueService(domain);
  const result = await service.approve({ approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(result.publicationBatch.publishedListingCount, 1);
  assert.equal(domain.get('MARKETPLACE_LISTING', 'LIST-1').status, 'LIVE');
  assert.equal(domain.get('MARKETPLACE_LISTING', 'LIST-BLOCKED').state, 'PREPARED');
  assert.equal(result.after.eligibleListingCount, 0);
});
