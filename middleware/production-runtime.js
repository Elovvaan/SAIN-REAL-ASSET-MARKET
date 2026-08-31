import crypto from 'node:crypto';

const buckets = new Map();
const metrics = {
  startedAt: new Date().toISOString(),
  requests: 0,
  errors: 0,
  rateLimited: 0,
  totalDurationMs: 0,
  byStatus: {},
  byRoute: {},
  recentErrors: [],
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_RATE_LIMIT_BUCKET_MAX = 5000;
const DEFAULT_ROUTE_METRIC_MAX = 500;
const RATE_LIMIT_SWEEP_INTERVAL = 256;
let requestSweepCounter = 0;

function now() { return Date.now(); }
function boundedPositiveInteger(value, fallback, minimum = 1, maximum = 100000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return Math.min(parsed, maximum);
}
function requestId(req) { return String(req.get('x-request-id') || req.get('x-correlation-id') || crypto.randomUUID()).slice(0, 128); }
function clientKey(req) { return req.sraIdentity?.actorId || req.ip || req.socket?.remoteAddress || 'unknown'; }
function routeClass(path, method = 'GET') {
  if (path.startsWith('/api/admin')) return SAFE_METHODS.has(String(method).toUpperCase()) ? 'ADMIN_READ' : 'ADMIN_WRITE';
  if (path.startsWith('/api/access/signin') || path.startsWith('/api/access/signup')) return 'AUTH';
  if (path.startsWith('/api/funding') || path.startsWith('/api/sain/intelligence')) return 'OPERATIONS';
  if (path.startsWith('/api/production')) return 'PRODUCTION';
  return 'GENERAL';
}
function limits(kind) {
  const defaults = {
    AUTH: [20, 60_000],
    OPERATIONS: [120, 60_000],
    PRODUCTION: [60, 60_000],
    ADMIN_READ: [2400, 60_000],
    ADMIN_WRITE: [120, 60_000],
    GENERAL: [300, 60_000]
  };
  const [count, windowMs] = defaults[kind] || defaults.GENERAL;
  return [Number(process.env[`SRA_RATE_LIMIT_${kind}`]) || count, Number(process.env.SRA_RATE_LIMIT_WINDOW_MS) || windowMs];
}
function rateLimitBucketMax() {
  return boundedPositiveInteger(process.env.SRA_RATE_LIMIT_BUCKET_MAX, DEFAULT_RATE_LIMIT_BUCKET_MAX, 100, 100000);
}
function routeMetricMax() {
  return boundedPositiveInteger(process.env.SRA_ROUTE_METRIC_MAX, DEFAULT_ROUTE_METRIC_MAX, 10, 10000);
}
function pruneExpiredBuckets(timestamp = now()) {
  for (const [key, bucket] of buckets.entries()) if (!bucket || bucket.resetAt <= timestamp) buckets.delete(key);
}
function enforceBucketCapacity(timestamp = now()) {
  const maximum = rateLimitBucketMax();
  if (buckets.size < maximum) return;
  pruneExpiredBuckets(timestamp);
  while (buckets.size >= maximum) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}
function normalizeMetricPath(value) {
  const path = String(value || '/').slice(0, 512);
  const segments = path.split('/').map((segment) => {
    if (!segment) return segment;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return ':uuid';
    if (/^\d{4,}$/.test(segment)) return ':number';
    if (/^[A-Za-z]{1,16}-[A-Za-z0-9_-]{6,}$/.test(segment)) return ':id';
    if (/^[A-Fa-f0-9]{20,}$/.test(segment)) return ':token';
    if (segment.length > 64) return ':value';
    return segment;
  });
  return segments.join('/') || '/';
}
function metricRouteKey(req) {
  const candidate = `${req.method} ${normalizeMetricPath(req.path)}`;
  if (metrics.byRoute[candidate]) return candidate;
  const maximum = routeMetricMax();
  const specificLimit = Math.max(1, maximum - 1);
  if (Object.keys(metrics.byRoute).length < specificLimit) return candidate;
  return 'OTHER';
}
function writeLog(level, payload) {
  const line = JSON.stringify({ level, service: 'SAIN_REAL_ASSET_MARKET', environment: process.env.NODE_ENV || 'development', ...payload });
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
}
async function sendAlert(payload) {
  const url = process.env.SRA_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
  } catch (error) {
    writeLog('error', { event: 'ALERT_DELIVERY_FAILED', message: error.message });
  }
}

export function productionRuntime(req, res, next) {
  const id = requestId(req);
  const started = now();
  req.sraRequestId = id;
  res.set('x-request-id', id);

  const kind = routeClass(req.path, req.method);
  const [max, windowMs] = limits(kind);
  const key = `${kind}:${clientKey(req)}`;
  const timestamp = now();
  requestSweepCounter += 1;
  if (requestSweepCounter >= RATE_LIMIT_SWEEP_INTERVAL) {
    pruneExpiredBuckets(timestamp);
    requestSweepCounter = 0;
  }
  const current = buckets.get(key);
  if (!current && buckets.size >= rateLimitBucketMax()) enforceBucketCapacity(timestamp);
  const bucket = !current || current.resetAt <= timestamp ? { count: 0, resetAt: timestamp + windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  res.set('x-ratelimit-limit', String(max));
  res.set('x-ratelimit-remaining', String(Math.max(0, max - bucket.count)));
  res.set('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > max) {
    metrics.rateLimited += 1;
    writeLog('warn', { event: 'RATE_LIMITED', requestId: id, method: req.method, path: req.path, class: kind, actorId: req.sraIdentity?.actorId || null });
    return res.status(429).json({ error: 'Too many requests.', code: 'SRA_RATE_LIMIT_EXCEEDED', requestId: id, retryAfterMs: bucket.resetAt - timestamp });
  }

  metrics.requests += 1;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && res.statusCode >= 400 && !body.requestId) body.requestId = id;
    return originalJson(body);
  };
  res.on('finish', () => {
    const durationMs = now() - started;
    const status = res.statusCode;
    metrics.totalDurationMs += durationMs;
    metrics.byStatus[status] = (metrics.byStatus[status] || 0) + 1;
    const route = metricRouteKey(req);
    const routeMetric = metrics.byRoute[route] || { requests: 0, errors: 0, totalDurationMs: 0, maxDurationMs: 0 };
    routeMetric.requests += 1;
    routeMetric.totalDurationMs += durationMs;
    routeMetric.maxDurationMs = Math.max(routeMetric.maxDurationMs, durationMs);
    if (status >= 500) routeMetric.errors += 1;
    metrics.byRoute[route] = routeMetric;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    writeLog(level, { event: 'HTTP_REQUEST', requestId: id, method: req.method, path: req.path, status, durationMs, actorId: req.sraIdentity?.actorId || null, idempotencyKey: req.sraIdempotencyKey || null });
    if (status >= 500) {
      metrics.errors += 1;
      metrics.recentErrors.unshift({ requestId: id, method: req.method, path: normalizeMetricPath(req.path), status, durationMs, at: new Date().toISOString() });
      metrics.recentErrors = metrics.recentErrors.slice(0, 50);
      void sendAlert({ severity: 'ERROR', event: 'SRA_HTTP_5XX', requestId: id, method: req.method, path: normalizeMetricPath(req.path), status, durationMs, at: new Date().toISOString() });
    }
  });
  return next();
}

export function runtimeMetrics() {
  const routes = Object.fromEntries(Object.entries(metrics.byRoute).map(([route, value]) => [route, { ...value, averageDurationMs: value.requests ? Number((value.totalDurationMs / value.requests).toFixed(2)) : 0 }]));
  return { ...metrics, averageDurationMs: metrics.requests ? Number((metrics.totalDurationMs / metrics.requests).toFixed(2)) : 0, byRoute: routes, routeMetricKeys: Object.keys(metrics.byRoute).length, rateLimitBuckets: buckets.size, generatedAt: new Date().toISOString() };
}

export async function dependencyHealth({ database, startupState, connectors = {} }) {
  const checks = [];
  try {
    const db = await database?.health?.();
    const databaseReady = Boolean(db?.ready);
    checks.push({ id: 'DATABASE', status: databaseReady ? 'PASS' : 'FAIL', detail: db || null });
    if (databaseReady && db?.persistent === false) {
      checks.push({
        id: 'DATABASE_PERSISTENCE',
        status: 'WARN',
        detail: {
          mode: db.mode,
          persistent: false,
          message: 'The database service is ready in memory fallback mode. Configure DATABASE_URL for durable persistence.'
        }
      });
    }
  } catch (error) {
    checks.push({ id: 'DATABASE', status: 'FAIL', error: error.message });
  }
  checks.push({ id: 'APPLICATION_STARTUP', status: startupState === 'READY' ? 'PASS' : 'FAIL', detail: startupState });
  for (const [id, service] of Object.entries(connectors)) {
    try { const state = service?.status?.() || null; checks.push({ id, status: state ? 'PASS' : 'WARN', detail: state }); }
    catch (error) { checks.push({ id, status: 'FAIL', error: error.message }); }
  }
  const failed = checks.filter((check) => check.status === 'FAIL');
  return { status: failed.length ? 'NOT_READY' : 'READY', checks, generatedAt: new Date().toISOString() };
}

export async function emitOperationalAlert(payload) { return sendAlert(payload); }
