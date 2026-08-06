import assert from 'node:assert/strict';
import test from 'node:test';
import { SraCoinAgentService } from '../services/sra-coin-agent-service.js';
import { SraCoinAgentInspectionService } from '../services/sra-coin-agent-inspection-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  put(type, id, payload) { this.records.set(this.key(type, id), { ...payload }); }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => ({ ...value })); }
}

test('direct inspection explains a ready Coin Position and publication effect', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-READY', { positionId: 'CP-READY', participantId: 'P-1', instrumentId: 'INS-1', availableQuantity: 50, unit: 'SRA', state: 'AVAILABLE' });
  domain.put('SRA_INSTRUMENT', 'INS-1', { instrumentId: 'INS-1', state: 'ACTIVE' });
  domain.put('MARKETPLACE_LISTING', 'LIST-1', { listingId: 'LIST-1', instrumentId: 'INS-1', state: 'PREPARED', status: 'READY_FOR_PUBLICATION_APPROVAL' });
  const service = new SraCoinAgentInspectionService(new SraCoinAgentService(domain));
  const result = service.inspect('CP-READY');
  assert.equal(result.agent.nextEligibleAction, 'AUTHORIZE_PUBLICATION');
  assert.equal(result.actionImpact.humanApprovalRequired, true);
  assert.equal(result.actionImpact.canAgentExecute, false);
  assert.match(result.actionImpact.effect, /Publish/);
  assert.ok(result.actionImpact.remainsLocked.includes('SETTLEMENT'));
});

test('direct inspection remains read-only for settlement authorization', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-SELLER', { positionId: 'CP-SELLER', participantId: 'SELLER', instrumentId: 'INS-2', availableQuantity: 10, unit: 'SRA', state: 'AVAILABLE' });
  domain.put('SRA_INSTRUMENT', 'INS-2', { instrumentId: 'INS-2', state: 'ACTIVE' });
  domain.put('SRA_TRANSACTION', 'RSV-2', { transactionId: 'RSV-2', reservationId: 'RSV-2', transactionType: 'PRE_ALLOCATION_RESERVATION', sellerPositionId: 'CP-SELLER', instrumentId: 'INS-2', positionReservation: { positionId: 'CP-SELLER', state: 'HELD', quantity: 4 } });
  domain.put('SRA_TRANSACTION', 'ALC-2', { transactionId: 'ALC-2', allocationId: 'ALC-2', transactionType: 'POSITION_ALLOCATION_APPROVAL', reservationId: 'RSV-2', state: 'ALLOCATION_APPROVED_PENDING_SETTLEMENT' });
  const result = new SraCoinAgentInspectionService(new SraCoinAgentService(domain)).inspect('CP-SELLER');
  assert.equal(result.agent.nextEligibleAction, 'AUTHORIZE_SETTLEMENT');
  assert.equal(result.actionImpact.canAgentExecute, false);
  assert.ok(result.actionImpact.remainsLocked.includes('EXTERNAL_TRANSFER'));
});
