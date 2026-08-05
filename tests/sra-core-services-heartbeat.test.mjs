import assert from 'node:assert/strict';
import test from 'node:test';
import { SraCoreEventBus } from '../services/sra-core-event-bus.js';
import { SraCoreServicesHeartbeat } from '../services/sra-core-services-heartbeat.js';
import { createSraCoreEngineRegistry } from '../services/sra-core-engine-registry.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor({ persisted = {} } = {}) {
    this.records = new Map();
    this.cache = new Map();
    this.persisted = persisted;
    this.database = { listRecords: async (type) => this.persisted[type] || [] };
  }
  key(type, id) { return `${type}:${id}`; }
  list(type) {
    const prefix = `${type}:`;
    const source = new Map([...this.records, ...this.cache]);
    return [...source.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => {
      const { __type, ...record } = value;
      return record;
    });
  }
  async put(type, id, record) { this.records.set(this.key(type, id), { __type: type, ...record }); return record; }
}

test('core heartbeat runs engines, persists cycle, and emits events', async () => {
  const domain = new MemoryDomain();
  const eventBus = new SraCoreEventBus();
  const events = [];
  eventBus.subscribe('*', (event) => events.push(event.eventType));
  const heartbeat = new SraCoreServicesHeartbeat({
    domain,
    eventBus,
    engines: [
      { name: 'ONE', async run() { return { moved: 3 }; } },
      { name: 'TWO', async run() { return { moved: 4 }; } },
    ],
  });
  const result = await heartbeat.runCycle('TEST');
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.completedEngines, 2);
  assert.equal(domain.list('SRA_CORE_HEARTBEAT_CYCLE').length, 1);
  assert.match(result.cycleId, /^HBT-[0-9A-F-]{36}$/);
  assert.ok(events.includes('SRA_CORE_CYCLE_STARTED'));
  assert.ok(events.includes('SRA_CORE_CYCLE_COMPLETED'));
});

test('subscriber failures cannot strand the heartbeat running flag', async () => {
  const domain = new MemoryDomain();
  const eventBus = new SraCoreEventBus();
  eventBus.subscribe('SRA_CORE_CYCLE_STARTED', () => { throw new Error('subscriber failure'); });
  eventBus.subscribe('*', () => { throw new Error('wildcard failure'); });
  const heartbeat = new SraCoreServicesHeartbeat({ domain, eventBus, engines: [] });
  const first = await heartbeat.runCycle('TEST');
  const second = await heartbeat.runCycle('TEST_AGAIN');
  assert.equal(first.state, 'COMPLETED');
  assert.equal(second.state, 'COMPLETED');
  assert.equal(heartbeat.running, false);
});

test('core heartbeat isolates engine failure and completes with errors', async () => {
  const domain = new MemoryDomain();
  const heartbeat = new SraCoreServicesHeartbeat({
    domain,
    eventBus: new SraCoreEventBus(),
    engines: [
      { name: 'GOOD', async run() { return { ok: true }; } },
      { name: 'BAD', async run() { throw new Error('boom'); } },
    ],
  });
  const result = await heartbeat.runCycle('TEST');
  assert.equal(result.state, 'COMPLETED_WITH_ERRORS');
  assert.equal(result.completedEngines, 1);
  assert.equal(result.failedEngines, 1);
});

test('heartbeat hydrates persisted cycles and active policies after restart', async () => {
  const domain = new MemoryDomain({ persisted: {
    SRA_CORE_HEARTBEAT_CYCLE: [{ cycleId: 'HBT-PERSISTED', state: 'COMPLETED', completedAt: '2026-08-05T00:00:00.000Z' }],
    SRA_CORE_POLICY: [{ policyId: 'POL-1', state: 'ACTIVE' }],
  } });
  const heartbeat = new SraCoreServicesHeartbeat({ domain, eventBus: new SraCoreEventBus(), engines: [] });
  await heartbeat.initialize();
  assert.equal(heartbeat.status().cycleCount, 1);
  assert.equal(heartbeat.status().activePolicyCount, 1);
  assert.equal(heartbeat.status().latestCycle.cycleId, 'HBT-PERSISTED');
});

test('recognition engine reads the canonical market observation record type', async () => {
  const domain = new MemoryDomain();
  domain.records.set(domain.key(RECORD_TYPES.MARKET_OBSERVATION, 'OBS-1'), { __type: RECORD_TYPES.MARKET_OBSERVATION, observationId: 'OBS-1' });
  const recognition = createSraCoreEngineRegistry()[0];
  const result = await recognition.run({ domain });
  assert.equal(result.recordsObserved, 1);
});
