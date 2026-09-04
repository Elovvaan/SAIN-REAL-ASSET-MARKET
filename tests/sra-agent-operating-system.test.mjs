import assert from 'node:assert/strict';
import test from 'node:test';
import { SraAgentOperatingSystemService } from '../services/sra-agent-operating-system-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  put(type, id, value) { this.records.set(this.key(type, id), { ...value }); }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => ({ ...value })); }
}

test('agent operating system registers specialized read-only agents', () => {
  const domain = new MemoryDomain();
  domain.put('COIN_POSITION', 'CP-1', { positionId: 'CP-1', participantId: 'P-1', instrumentId: 'INS-1', availableQuantity: 5, unit: 'SRA' });
  domain.put('SRA_INSTRUMENT', 'INS-1', { instrumentId: 'INS-1' });
  domain.put('MARKETPLACE_LISTING', 'LIST-1', { listingId: 'LIST-1', instrumentId: 'INS-1', status: 'LIVE' });
  const service = new SraAgentOperatingSystemService(domain);
  const registry = service.registry();
  assert.equal(registry.length, 7);
  assert.ok(registry.every((agent) => agent.state === 'ACTIVE'));
  assert.equal(registry.find((agent) => agent.agentType === 'COIN_AGENT').recordCount, 1);
  assert.equal(registry.find((agent) => agent.agentType === 'LISTING_AGENT').recordCount, 1);
  assert.ok(registry.some((agent) => agent.agentId === 'SRA-CAPITAL-ACTIVATION-AGENT'));
});

test('agent operating system coordinates queue and heartbeat without granting authority', () => {
  const domain = new MemoryDomain();
  const operationsQueue = { explain: () => ({ totalAwaitingAction: 3, totalExceptions: 1, nextRecommendedAction: { action: 'SETTLE', id: 'ALC-1' } }) };
  const coreHeartbeat = { status: () => ({ schedulerState: 'RUNNING', cycleCount: 12 }) };
  const brief = new SraAgentOperatingSystemService(domain, { operationsQueue, coreHeartbeat }).brief();
  assert.equal(brief.state, 'ATTENTION_REQUIRED');
  assert.equal(brief.coordination.waitingGovernedActions, 3);
  assert.equal(brief.coordination.exceptions, 1);
  assert.equal(brief.coordination.completedCycles, 12);
  assert.ok(brief.authorityBoundary.includes('NO_SELF_APPROVAL'));
  assert.ok(brief.authorityBoundary.includes('NO_UNAUTHORIZED_VALUE_MOVEMENT'));
});
