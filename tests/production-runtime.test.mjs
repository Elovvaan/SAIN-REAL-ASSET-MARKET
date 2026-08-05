import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { productionRuntime, runtimeMetrics, dependencyHealth } from '../middleware/production-runtime.js';

test('request tracing returns a request ID and records metrics', async () => {
  const app = express();
  app.use(productionRuntime);
  app.get('/ok', (_req, res) => res.json({ ok: true }));
  const response = await request(app).get('/ok').expect(200);
  assert.ok(response.headers['x-request-id']);
  const metrics = runtimeMetrics();
  assert.ok(metrics.requests >= 1);
  assert.ok(metrics.byRoute['GET /ok']);
});

test('client request ID is preserved', async () => {
  const app = express(); app.use(productionRuntime); app.get('/trace', (_req, res) => res.json({ ok: true }));
  const response = await request(app).get('/trace').set('x-request-id', 'REQ-123').expect(200);
  assert.equal(response.headers['x-request-id'], 'REQ-123');
});

test('rate limiter blocks requests over configured auth limit', async () => {
  const previous = process.env.SRA_RATE_LIMIT_AUTH;
  process.env.SRA_RATE_LIMIT_AUTH = '1';
  const app = express(); app.use(productionRuntime); app.post('/api/access/signin', (_req, res) => res.json({ ok: true }));
  await request(app).post('/api/access/signin').expect(200);
  const limited = await request(app).post('/api/access/signin').expect(429);
  assert.equal(limited.body.code, 'SRA_RATE_LIMIT_EXCEEDED');
  if (previous == null) delete process.env.SRA_RATE_LIMIT_AUTH; else process.env.SRA_RATE_LIMIT_AUTH = previous;
});

test('dependency health fails when database is not persistent', async () => {
  const report = await dependencyHealth({ database: { health: async () => ({ persistent: false }) }, startupState: 'READY' });
  assert.equal(report.status, 'NOT_READY');
});

test('dependency health passes with persistent database and ready startup', async () => {
  const report = await dependencyHealth({ database: { health: async () => ({ persistent: true }) }, startupState: 'READY' });
  assert.equal(report.status, 'READY');
});
