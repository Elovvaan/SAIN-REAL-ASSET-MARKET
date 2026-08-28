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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class ControlledDatabase {
  constructor() {
    this.records = new Map();
    this.putCalls = [];
    this.auditCalls = [];
    this.firstPutGate = deferred();
    this.firstAuditGate = deferred();
    this.failFirstPut = false;
    this.delayFirstPut = false;
    this.delayFirstAudit = false;
  }

  async putRecord(type, id, record) {
    const callNumber = this.putCalls.length + 1;
    this.putCalls.push({ type, id, record: JSON.parse(JSON.stringify(record)) });
    if (callNumber === 1 && this.delayFirstPut) await this.firstPutGate.promise;
    if (callNumber === 1 && this.failFirstPut) throw new Error('first write failed');
    this.records.set(`${type}:${id}`, JSON.parse(JSON.stringify(record)));
  }

  async audit(event) {
    const callNumber = this.auditCalls.length + 1;
    this.auditCalls.push(JSON.parse(JSON.stringify(event)));
    if (callNumber === 1 && this.delayFirstAudit) await this.firstAuditGate.promise;
  }

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

test('overlapping puts for one key are serialized when the older write fails', async () => {
  const database = new ControlledDatabase();
  database.delayFirstPut = true;
  database.failFirstPut = true;
  const domain = new PersistentDomainService(database);
  const older = { id: 'AD-CONTEXT-EXP-2', decisionId: 'AD-CONTEXT-EXP-2', decision: 'BLOCKED' };
  const newer = { ...older, decision: 'READY' };

  const olderPromise = domain.put('AGENT_DECISION', older.id, older);
  await Promise.resolve();
  const newerPromise = domain.put('AGENT_DECISION', newer.id, newer);
  await Promise.resolve();

  assert.equal(database.putCalls.length, 1);
  database.firstPutGate.resolve();

  await assert.rejects(olderPromise, /first write failed/);
  await newerPromise;

  assert.equal(database.putCalls.length, 2);
  assert.deepEqual(domain.get('AGENT_DECISION', newer.id), newer);
  assert.deepEqual(database.records.get(`AGENT_DECISION:${newer.id}`), newer);
});

test('a slow older audit cannot overwrite a newer cache value', async () => {
  const database = new ControlledDatabase();
  database.delayFirstAudit = true;
  const domain = new PersistentDomainService(database);
  const older = { id: 'AP-CONTEXT-EXP-2', planId: 'AP-CONTEXT-EXP-2', status: 'BLOCKED_CONTEXT_REQUIRED' };
  const newer = { ...older, status: 'READY' };

  const olderPromise = domain.put('ACTION_PLAN', older.id, older);
  while (database.auditCalls.length === 0) await Promise.resolve();
  const newerPromise = domain.put('ACTION_PLAN', newer.id, newer);
  await Promise.resolve();

  assert.equal(database.putCalls.length, 1);
  database.firstAuditGate.resolve();

  await olderPromise;
  await newerPromise;

  assert.equal(database.putCalls.length, 2);
  assert.deepEqual(domain.get('ACTION_PLAN', newer.id), newer);
  assert.deepEqual(database.records.get(`ACTION_PLAN:${newer.id}`), newer);
});

test('atomicPut waits for an in-flight put on the same key and survives the older failure', async () => {
  const database = new ControlledDatabase();
  database.delayFirstPut = true;
  database.failFirstPut = true;
  const domain = new PersistentDomainService(database);
  const older = { id: 'AP-CONTEXT-EXP-3', planId: 'AP-CONTEXT-EXP-3', status: 'BLOCKED_CONTEXT_REQUIRED' };
  const atomic = { ...older, status: 'READY' };

  const olderPromise = domain.put('ACTION_PLAN', older.id, older);
  await Promise.resolve();
  const atomicPromise = domain.atomicPut([{ type: 'ACTION_PLAN', id: atomic.id, payload: atomic }]);
  await Promise.resolve();

  assert.equal(database.putCalls.length, 1);
  database.firstPutGate.resolve();

  await assert.rejects(olderPromise, /first write failed/);
  await atomicPromise;

  assert.equal(database.putCalls.length, 2);
  assert.deepEqual(domain.get('ACTION_PLAN', atomic.id), atomic);
  assert.deepEqual(database.records.get(`ACTION_PLAN:${atomic.id}`), atomic);
});

test('put waits for an in-flight atomicPut on the same key and remains the newest value', async () => {
  const database = new ControlledDatabase();
  database.delayFirstPut = true;
  const domain = new PersistentDomainService(database);
  const atomic = { id: 'AD-CONTEXT-EXP-3', decisionId: 'AD-CONTEXT-EXP-3', decision: 'BLOCKED' };
  const newer = { ...atomic, decision: 'READY' };

  const atomicPromise = domain.atomicPut([{ type: 'AGENT_DECISION', id: atomic.id, payload: atomic }]);
  await Promise.resolve();
  const newerPromise = domain.put('AGENT_DECISION', newer.id, newer);
  await Promise.resolve();

  assert.equal(database.putCalls.length, 1);
  database.firstPutGate.resolve();

  await atomicPromise;
  await newerPromise;

  assert.equal(database.putCalls.length, 2);
  assert.deepEqual(domain.get('AGENT_DECISION', newer.id), newer);
  assert.deepEqual(database.records.get(`AGENT_DECISION:${newer.id}`), newer);
});
