import assert from 'node:assert/strict';
import test from 'node:test';
import { SraCoreEventBus } from '../services/sra-core-event-bus.js';
import { SraCoreServicesHeartbeat } from '../services/sra-core-services-heartbeat.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.values()].filter((item) => item.__type === type).map(({ __type, ...item }) => item); }
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
  assert.ok(events.includes('SRA_CORE_CYCLE_STARTED'));
  assert.ok(events.includes('SRA_CORE_CYCLE_COMPLETED'));
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
