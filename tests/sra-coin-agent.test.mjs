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
  const result = new SraCoinAgentService(domain).explain('CP-1');
  assert.equal(result.currentState, 'AVAILABLE');
  assert.equal(result.marketplaceState, 'LIVE');
  assert.equal(result.nextEligibleAction, 'AVAILABLE_FOR_GOVERNED_MARKET_PARTICIPATION');
  assert.equal(result.humanApprovalRequired, false);
  assert.ok(result.prohibitedActions.includes('SELF_APPROVE'));
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
});

test('coin agent binds allocation and settlement through reservation lineage', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-A', { positionId: 'CP-A', participantId: 'SELLER-A', instrumentId: 'INS-X', availableQuantity: 5, unit: 'SRA', state: 'ACTIVE' });
  domain.put('COIN_POSITION', 'CP-B', { positionId: 'CP-B', participantId: 'SELLER-B', instrumentId: 'INS-X', availableQuantity: 9, unit: 'SRA', state: 'ACTIVE' });
  domain.put('SRA_INSTRUMENT', 'INS-X', { instrumentId: 'INS-X', state: 'ACTIVE' });
  domain.put('SRA_TRANSACTION', 'RSV-A', { reservationId: 'RSV-A', transactionId: 'RSV-A', transactionType: 'PRE_ALLOCATION_RESERVATION', sellerPositionId: 'CP-A', instrumentId: 'INS-X', positionReservation: { positionId: 'CP-A', quantity: 2, state: 'CONSUMED' } });
  domain.put('SRA_TRANSACTION', 'AL-A', { allocationId: 'AL-A', transactionId: 'AL-A', transactionType: 'POSITION_ALLOCATION_APPROVAL', reservationId: 'RSV-A', instrumentId: 'INS-X', state: 'SETTLED' });
  domain.put('SRA_TRANSACTION', 'SET-A', { settlementId: 'SET-A', transactionId: 'SET-A', transactionType: 'ATOMIC_ORDER_SETTLEMENT', reservationId: 'RSV-A', allocationId: 'AL-A', buyerPositionId: 'CP-BUY', instrumentId: 'INS-X', state: 'SETTLED' });
  domain.put('SRA_TRANSACTION', 'AL-B', { allocationId: 'AL-B', transactionId: 'AL-B', transactionType: 'POSITION_ALLOCATION_APPROVAL', instrumentId: 'INS-X', pendingBuyerPositionId: 'OTHER', state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT' });
  const result = new SraCoinAgentService(domain).explain('CP-A');
  assert.equal(result.lineage.allocationId, 'AL-A');
  assert.equal(result.lineage.settlementId, 'SET-A');
  assert.notEqual(result.nextEligibleAction, 'AUTHORIZE_SETTLEMENT');
});

test('coin agent resolves completed external result through transfer instruction lineage', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-5', { positionId: 'CP-5', participantId: 'P-5', instrumentId: 'INS-5', availableQuantity: 0, externalizedQuantity: 6, unit: 'SRA', state: 'EXTERNALLY_TRANSFERRED' });
  domain.put('SRA_INSTRUMENT', 'INS-5', { instrumentId: 'INS-5', state: 'ACTIVE' });
  domain.put('EXPORT_PACKAGE', 'EXP-5', { exportPackageId: 'EXP-5', positionId: 'CP-5', settlementId: 'SET-5', state: 'EXTERNAL_TRANSFER_COMPLETED' });
  domain.put('SRA_TRANSACTION', 'XFR-5', { transactionId: 'XFR-5', transferInstructionId: 'XFR-5', transactionType: 'EXTERNAL_TRANSFER_INSTRUCTION', exportPackageId: 'EXP-5', positionId: 'CP-5', instrumentId: 'INS-5', transferResultId: 'XRS-5', state: 'EXTERNAL_TRANSFER_COMPLETED', executionState: 'COMPLETED' });
  domain.put('SRA_TRANSACTION', 'XAU-5', { transactionId: 'XAU-5', executionAuthorizationId: 'XAU-5', transactionType: 'EXTERNAL_TRANSFER_EXECUTION_AUTHORIZATION', transferInstructionId: 'XFR-5', positionId: 'CP-5', instrumentId: 'INS-5', state: 'EXECUTION_AUTHORIZED' });
  domain.put('SRA_TRANSACTION', 'XRS-5', { transactionId: 'XRS-5', transferResultId: 'XRS-5', transactionType: 'EXTERNAL_TRANSFER_RESULT', transferInstructionId: 'XFR-5', exportPackageId: 'EXP-5', result: 'COMPLETED', state: 'EXTERNAL_TRANSFER_COMPLETED' });
  const result = new SraCoinAgentService(domain).explain('CP-5');
  assert.equal(result.currentState, 'EXTERNALLY_HELD');
  assert.equal(result.nextEligibleAction, 'MONITOR_EXTERNAL_HOLDING');
  assert.equal(result.externallyTransferredQuantity, 6);
  assert.equal(result.lineage.externalResultId, 'XRS-5');
});

test('coin agent resolves failed external result through transfer instruction lineage', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-6', { positionId: 'CP-6', participantId: 'P-6', instrumentId: 'INS-6', availableQuantity: 6, unit: 'SRA', state: 'ACTIVE' });
  domain.put('SRA_INSTRUMENT', 'INS-6', { instrumentId: 'INS-6', state: 'ACTIVE' });
  domain.put('EXPORT_PACKAGE', 'EXP-6', { exportPackageId: 'EXP-6', positionId: 'CP-6', state: 'EXTERNAL_TRANSFER_FAILED' });
  domain.put('SRA_TRANSACTION', 'XFR-6', { transactionId: 'XFR-6', transferInstructionId: 'XFR-6', transactionType: 'EXTERNAL_TRANSFER_INSTRUCTION', exportPackageId: 'EXP-6', positionId: 'CP-6', instrumentId: 'INS-6', transferResultId: 'XRS-6', state: 'EXTERNAL_TRANSFER_FAILED', executionState: 'FAILED' });
  domain.put('SRA_TRANSACTION', 'XRS-6', { transactionId: 'XRS-6', transferResultId: 'XRS-6', transactionType: 'EXTERNAL_TRANSFER_RESULT', transferInstructionId: 'XFR-6', exportPackageId: 'EXP-6', result: 'FAILED', state: 'EXTERNAL_TRANSFER_FAILED' });
  const result = new SraCoinAgentService(domain).explain('CP-6');
  assert.equal(result.currentState, 'EXTERNAL_TRANSFER_FAILED');
  assert.equal(result.nextEligibleAction, 'REVIEW_FAILED_EXTERNAL_TRANSFER');
});

test('coin agent reads publication readiness from listing status', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-7', { positionId: 'CP-7', participantId: 'P-7', instrumentId: 'INS-7', availableQuantity: 1, unit: 'SRA', state: 'ACTIVE' });
  domain.put('SRA_INSTRUMENT', 'INS-7', { instrumentId: 'INS-7', state: 'ACTIVE' });
  domain.put('MARKETPLACE_LISTING', 'LIST-7', { listingId: 'LIST-7', instrumentId: 'INS-7', state: 'PREPARED', status: 'READY_FOR_PUBLICATION_APPROVAL' });
  const result = new SraCoinAgentService(domain).explain('CP-7');
  assert.equal(result.marketplaceState, 'READY_FOR_PUBLICATION_APPROVAL');
  assert.equal(result.nextEligibleAction, 'AUTHORIZE_PUBLICATION');
  assert.equal(result.humanApprovalRequired, true);
});

test('coin agent reports blockers instead of inventing missing authority', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-3', { positionId: 'CP-3', availableQuantity: 3, unit: 'SRA', frozen: true });
  const result = new SraCoinAgentService(domain).explain('CP-3');
  assert.deepEqual(result.blockers.sort(), ['NO_LINKED_INSTRUMENT', 'NO_RECOGNIZED_PARTICIPANT', 'POSITION_RESTRICTED'].sort());
});

test('operations queue attaches affected coin agent explanation', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-4', { positionId: 'CP-4', participantId: 'SELLER', instrumentId: 'INS-4', availableQuantity: 7, unit: 'SRA', state: 'AVAILABLE' });
  domain.put('SRA_INSTRUMENT', 'INS-4', { instrumentId: 'INS-4', state: 'ACTIVE' });
  domain.put('SRA_TRANSACTION', 'RSV-4', { transactionId: 'RSV-4', reservationId: 'RSV-4', transactionType: 'PRE_ALLOCATION_RESERVATION', state: 'RESERVED_PENDING_ALLOCATION_APPROVAL', sellerPositionId: 'CP-4', instrumentId: 'INS-4', positionReservation: { positionId: 'CP-4', quantity: 2, state: 'HELD' }, updatedAt: '2026-08-05T00:00:00Z' });
  const queue = new UnifiedMarketOperationsQueueService(domain).explain();
  assert.equal(queue.queue[0].coinAgent.positionId, 'CP-4');
  assert.equal(queue.queue[0].coinAgent.currentState, 'RESERVED');
});
