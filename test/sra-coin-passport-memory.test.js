import test from 'node:test';
import assert from 'node:assert/strict';
import { SraCoinAgentInspectionService } from '../services/sra-coin-agent-inspection-service.js';

function domain(records) {
  return {
    list(type) { return records[type] || []; },
  };
}

test('SRA Coin inspection returns a passport and memory without renaming the coin', () => {
  const records = {
    SRA_TRANSACTION: [
      {
        transactionId: 'RSV-1',
        transactionType: 'PRE_ALLOCATION_RESERVATION',
        reservationId: 'RSV-1',
        instrumentId: 'INS-1',
        sellerPositionId: 'CP-1',
        state: 'RESERVED_PENDING_ALLOCATION_APPROVAL',
        createdAt: '2026-08-05T20:00:00.000Z',
      },
    ],
    MARKETPLACE_LISTING: [
      { listingId: 'LIST-1', instrumentId: 'INS-1', status: 'LIVE', createdAt: '2026-08-05T19:00:00.000Z' },
    ],
    OWNERSHIP_RECOGNITION: [
      { id: 'OWN-1', positionId: 'CP-1', participantId: 'P-1', instrumentId: 'INS-1', state: 'RECOGNIZED' },
    ],
    EXPORT_PACKAGE: [],
  };
  const coinAgentService = {
    domain: domain(records),
    positions() { return [{ record: { coinPositionId: 'CP-1' } }]; },
    explain() {
      return {
        agentId: 'COIN-AGENT-CP-1',
        positionId: 'CP-1',
        denomination: 'SRA',
        quantity: 100,
        availableQuantity: 80,
        reservedQuantity: 20,
        externallyTransferredQuantity: 0,
        participantId: 'P-1',
        instrumentId: 'INS-1',
        ownershipState: 'RECOGNIZED',
        currentState: 'RESERVED',
        marketplaceState: 'LIVE',
        lineage: { listingIds: ['LIST-1'], reservationId: 'RSV-1' },
        blockers: [],
        capabilities: ['EXPLAIN_CURRENT_STATE'],
        prohibitedActions: ['SELF_APPROVE'],
        nextEligibleAction: 'APPROVE_ALLOCATION',
        humanApprovalRequired: true,
      };
    },
    list() { return []; },
    status() { return { coinAgentCount: 1 }; },
  };

  const result = new SraCoinAgentInspectionService(coinAgentService).inspect('CP-1');

  assert.equal(result.passport.assetName, 'SRA Coin');
  assert.equal(result.passport.passportType, 'SRA_COIN_AGENT_PASSPORT');
  assert.equal(result.passport.positionId, 'CP-1');
  assert.equal(result.passport.authorityBoundary, 'EXPLAIN_AND_PREPARE_ONLY');
  assert.equal(result.memory.assetName, 'SRA Coin');
  assert.equal(result.memory.memoryType, 'SRA_COIN_AGENT_MEMORY');
  assert.equal(result.memory.authoritativeSource, 'DERIVED_FROM_CANONICAL_PLATFORM_RECORDS');
  assert.ok(result.memory.events.some((entry) => entry.eventType === 'MARKETPLACE_LISTING'));
  assert.ok(result.memory.events.some((entry) => entry.eventType === 'PRE_ALLOCATION_RESERVATION'));
  assert.equal(result.actionImpact.canAgentExecute, false);
});
