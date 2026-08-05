import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseService } from '../services/database-service.js';
import { PersistentDomainService } from '../services/persistent-domain-service.js';
import { createOperationsIdempotency } from '../middleware/operations-idempotency.js';

function request({ path = '/api/funding/opportunities/FOP-100/complete-intake', body = {}, key = '', actorId = 'USR-ADMIN' } = {}) {
  return {
    method: 'POST', path, body,
    sraOperationsAuth: { actorId, roles: ['PLATFORM_ADMIN'], source: 'SERVER_SESSION' },
    get(name) { return String(name).toLowerCase() === 'x-sra-idempotency-key' ? key : ''; },
  };
}

function response() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    statusCode: 200,
    headers: {},
    body: null,
    sent: false,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    json(body) { this.body = body; this.sent = true; this.emit('finish'); return this; },
  });
}

async function invoke(middleware, req, handler) {
  const res = response();
  let nextPromise = null;
  await middleware(req, res, () => { nextPromise = Promise.resolve(handler(req, res)); });
  if (nextPromise) await nextPromise;
  for (let index = 0; index < 50 && !res.sent; index += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  return res;
}

async function memoryDatabase() {
  const database = new DatabaseService({ connectionString: '' });
  await database.initialize();
  return database;
}

test('completed response replays across middleware instances', async () => {
  const database = await memoryDatabase();
  const provider = async () => database;
  const first = createOperationsIdempotency({ databaseProvider: provider });
  const second = createOperationsIdempotency({ databaseProvider: provider });
  let executions = 0;

  const firstResponse = await invoke(first, request({ key: 'same-key' }), (_req, res) => {
    executions += 1;
    res.status(201).json({ opportunityId: 'FOP-100', status: 'INTAKE_COMPLETE' });
  });
  assert.equal(firstResponse.statusCode, 201);

  const replay = await invoke(second, request({ key: 'same-key' }), () => { executions += 1; });
  assert.equal(executions, 1);
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.headers['x-sra-idempotent-replay'], 'true');
  assert.deepEqual(replay.body, { opportunityId: 'FOP-100', status: 'INTAKE_COMPLETE' });
});

test('same idempotency key with different request is rejected', async () => {
  const database = await memoryDatabase();
  const middleware = createOperationsIdempotency({ databaseProvider: async () => database });
  await invoke(middleware, request({ key: 'conflict-key', body: { value: 1 } }), (_req, res) => res.json({ ok: true }));
  const conflict = await invoke(middleware, request({ key: 'conflict-key', body: { value: 2 } }), () => {});
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.code, 'SRA_IDEMPOTENCY_KEY_CONFLICT');
});

test('different actions against the same resource cannot overlap', async () => {
  const database = await memoryDatabase();
  const first = await database.claimIdempotency({ key: 'one', fingerprint: 'fp-one', actorId: 'A', resourceKey: 'SRA:FOP-100', ttlMs: 60000 });
  const second = await database.claimIdempotency({ key: 'two', fingerprint: 'fp-two', actorId: 'B', resourceKey: 'SRA:FOP-100', ttlMs: 60000 });
  assert.equal(first.state, 'CLAIMED');
  assert.equal(second.state, 'RESOURCE_BUSY');
});

test('failed operation releases its claim for retry', async () => {
  const database = await memoryDatabase();
  const middleware = createOperationsIdempotency({ databaseProvider: async () => database });
  const failed = await invoke(middleware, request({ key: 'retry-key' }), (_req, res) => res.status(422).json({ error: 'invalid' }));
  assert.equal(failed.statusCode, 422);
  const retried = await invoke(middleware, request({ key: 'retry-key' }), (_req, res) => res.status(201).json({ ok: true }));
  assert.equal(retried.statusCode, 201);
  assert.deepEqual(retried.body, { ok: true });
});

test('atomic domain batch updates cache only after all writes succeed', async () => {
  const database = await memoryDatabase();
  const domain = new PersistentDomainService(database);
  await domain.atomicPut([
    { type: 'FUNDING_OPPORTUNITY', id: 'FOP-1', payload: { opportunityId: 'FOP-1', status: 'VERIFIED' }, eventType: 'TEST_ONE' },
    { type: 'SRA_INSTRUMENT', id: 'INS-1', payload: { instrumentId: 'INS-1', status: 'ACTIVE' }, eventType: 'TEST_TWO' },
  ]);
  assert.equal(domain.get('FUNDING_OPPORTUNITY', 'FOP-1').status, 'VERIFIED');
  assert.equal(domain.get('SRA_INSTRUMENT', 'INS-1').status, 'ACTIVE');
  assert.equal((await database.listAuditEvents()).length, 2);
});
