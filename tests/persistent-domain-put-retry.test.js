import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentDomainService } from '../services/persistent-domain-service.js';

class FlakyDatabase {
  constructor() {
    this.records = new Map();
    this.putCalls = 0;
    this.failNextPut = true;
  }

  async putRecord(type, id, record) {
    this.putCalls += 1;
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('transient database failure');
    }
    this.records.set(`${type}:${id}`, JSON.parse(JSON.stringify(record)));
  }

  async audit() {}
  async listRecords(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => JSON.parse(JSON.stringify(value)));
  }
}

test('failed put does not leave an unpersisted record in cache and next attempt retries', async () => {
  const database = new FlakyDatabase();
  const domain = new PersistentDomainService(database);
  const record = { id: 'AD-CONTEXT-EXP-1', decisionId: 'AD-CONTEXT-EXP-1', decision: 'GENERATE_CONTEXT_REQUIRED_INSTRUCTIONS' };

  await assert.rejects(
    domain.put('AGENT_DECISION', record.id, record),
    /transient database failure/,
  );

  assert.equal(domain.get('AGENT_DECISION', record.id), null);
  assert.equal(database.records.has(`AGENT_DECISION:${record.id}`), false);

  await domain.put('AGENT_DECISION', record.id, record);

  assert.equal(database.putCalls, 2);
  assert.deepEqual(domain.get('AGENT_DECISION', record.id), record);
  assert.deepEqual(database.records.get(`AGENT_DECISION:${record.id}`), record);
});

test('failed overwrite restores the previously persisted cache value', async () => {
  const database = new FlakyDatabase();
  database.failNextPut = false;
  const domain = new PersistentDomainService(database);
  const original = { id: 'AP-CONTEXT-EXP-1', planId: 'AP-CONTEXT-EXP-1', status: 'BLOCKED_CONTEXT_REQUIRED' };
  const updated = { ...original, status: 'READY' };

  await domain.put('ACTION_PLAN', original.id, original);
  database.failNextPut = true;

  await assert.rejects(
    domain.put('ACTION_PLAN', updated.id, updated),
    /transient database failure/,
  );

  assert.deepEqual(domain.get('ACTION_PLAN', original.id), original);
  assert.deepEqual(database.records.get(`ACTION_PLAN:${original.id}`), original);

  await domain.put('ACTION_PLAN', updated.id, updated);
  assert.deepEqual(domain.get('ACTION_PLAN', updated.id), updated);
  assert.deepEqual(database.records.get(`ACTION_PLAN:${updated.id}`), updated);
});
