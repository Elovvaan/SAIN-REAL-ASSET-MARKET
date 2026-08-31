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

test('route metrics remain bounded under high-cardinality request paths', async () => {
  const previous = process.env.SRA_ROUTE_METRIC_MAX;
  process.env.SRA_ROUTE_METRIC_MAX = '10';
  const app = express();
  app.use(productionRuntime);
  app.use((_req, res) => res.json({ ok: true }));
  for (let index = 0; index < 24; index += 1) await request(app).get(`/probe-${index}-unique-path`).expect(200);
  const metrics = runtimeMetrics();
  assert.ok(metrics.routeMetricKeys <= 10);
  assert.ok(metrics.byRoute.OTHER);
  if (previous == null) delete process.env.SRA_ROUTE_METRIC_MAX; else process.env.SRA_ROUTE_METRIC_MAX = previous;
});

test('rate-limit client buckets remain bounded as client addresses change', async () => {
  const previous = process.env.SRA_RATE_LIMIT_BUCKET_MAX;
  process.env.SRA_RATE_LIMIT_BUCKET_MAX = '100';
  const app = express();
  app.set('trust proxy', true);
  app.use(productionRuntime);
  app.get('/bucket-test', (_req, res) => res.json({ ok: true }));
  for (let index = 0; index < 120; index += 1) {
    const third = Math.floor(index / 250);
    const fourth = (index % 250) + 1;
    await request(app).get('/bucket-test').set('x-forwarded-for', `10.20.${third}.${fourth}`).expect(200);
  }
  assert.ok(runtimeMetrics().rateLimitBuckets <= 100);
  if (previous == null) delete process.env.SRA_RATE_LIMIT_BUCKET_MAX; else process.env.SRA_RATE_LIMIT_BUCKET_MAX = previous;
});

test('dependency health fails when database is not persistent', async () => {
  const report = await dependencyHealth({ database: { health: async () => ({ persistent: false }) }, startupState: 'READY' });
  assert.equal(report.status, 'NOT_READY');
});

test('dependency health passes with persistent database and ready startup', async () => {
  const report = await dependencyHealth({ database: { health: async () => ({ ready: true, persistent: true }) }, startupState: 'READY' });
  assert.equal(report.status, 'READY');
});
