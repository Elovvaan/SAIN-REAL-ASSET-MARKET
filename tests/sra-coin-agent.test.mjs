import assert from 'node:assert/strict';
import test from 'node:test';
import { SraCoinAgentService } from '../services/sra-coin-agent-service.js';
import { UnifiedMarketOperationsQueueService } from '../services/unified-market-operations-queue-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  put(type, id, payload) { this.records.set(this.key(type, id), { ...payload }); }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => ({ ...value })); }
}

test('coin agent explains a live available SRA position without granting write authority', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-1', { positionId: 'CP-1', participantId: 'P-1', instrumentId: 'INS-1', availableQuantity: 25, unit: 'SRA', state: 'AVAILABLE', observationId: 'OBS-1', recognitionId: 'REC-1', financialRecordId: 'FR-1' });
  domain.put('SRA_INSTRUMENT', 'INS-1', { instrumentId: 'INS-1', state: 'ACTIVE' });
  domain.put('MARKETPLACE_LISTING', 'LIST-1', { listingId: 'LIST-1', instrumentId: 'INS-1', state: 'PUBLISHED', status: 'LIVE' });
  const service = new SraCoinAgentService(domain);
  const result = service.explain('CP-1');
  assert.equal(result.agentType, 'SRA_COIN_POSITION_AGENT');
  assert.equal(result.quantity, 25);
  assert.equal(result.currentState, 'AVAILABLE');
  assert.equal(result.marketplaceState, 'LIVE');
  assert.equal(result.nextEligibleAction, 'AVAILABLE_FOR_GOVERNED_MARKET_PARTICIPATION');
  assert.equal(result.humanApprovalRequired, false);
  assert.ok(result.prohibitedActions.includes('SELF_APPROVE'));
  assert.equal(result.lineage.observationId, 'OBS-1');
});

test('coin agent reports active reservation and allocation approval as next action', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-2', { positionId: 'CP-2', participantId: 'SELLER', instrumentId: 'INS-2', availableQuantity: 10, unit: 'SRA', state: 'AVAILABLE' });
  domain.put('SRA_INSTRUMENT', 'INS-2', { instrumentId: 'INS-2', state: 'ACTIVE' });
  domain.put('SRA_TRANSACTION', 'RSV-2', { transactionId: 'RSV-2', reservationId: 'RSV-2', transactionType: 'PRE_ALLOCATION_RESERVATION', state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', sellerPositionId: 'CP-2', instrumentId: 'INS-2', positionReservation: { positionId: 'CP-2', quantity: 4, state: 'HELD' } });
  const result = new SraCoinAgentService(domain).explain('CP-2');
  assert.equal(result.currentState, 'RESERVED');
  assert.equal(result.reservedQuantity, 4);
  assert.equal(result.nextEligibleAction, 'APPROVE_ALLOCATION');
  assert.equal(result.humanApprovalRequired, true);
  assert.equal(result.lineage.reservationId, 'RSV-2');
});

test('coin agent reports blockers instead of inventing missing authority', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-3', { positionId: 'CP-3', availableQuantity: 3, unit: 'SRA', frozen: true });
  const result = new SraCoinAgentService(domain).explain('CP-3');
  assert.deepEqual(result.blockers.sort(), ['NO_LINKED_INSTRUMENT', 'NO_RECOGNIZED_PARTICIPANT', 'POSITION_RESTRICTED'].sort());
  assert.equal(result.nextEligibleAction, 'RESOLVE_BLOCKERS');
});

test('operations queue attaches affected coin agent explanation', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-4', { positionId: 'CP-4', participantId: 'SELLER', instrumentId: 'INS-4', availableQuantity: 7, unit: 'SRA', state: 'AVAILABLE' });
  domain.put('SRA_INSTRUMENT', 'INS-4', { instrumentId: 'INS-4', state: 'ACTIVE' });
  domain.put('SRA_TRANSACTION', 'RSV-4', { transactionId: 'RSV-4', reservationId: 'RSV-4', transactionType: 'PRE_ALLOCATION_RESERVATION', state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', sellerPositionId: 'CP-4', instrumentId: 'INS-4', positionReservation: { positionId: 'CP-4', quantity: 2, state: 'HELD' }, updatedAt: '2026-08-05T00:00:00Z' });
  const queue = new UnifiedMarketOperationsQueueService(domain).explain();
  assert.equal(queue.totalAwaitingAction, 1);
  assert.equal(queue.queue[0].coinAgent.positionId, 'CP-4');
  assert.equal(queue.queue[0].coinAgent.currentState, 'RESERVED');
  assert.match(queue.nextRecommendedAction.explanation, /Coin Position CP-4/);
});
