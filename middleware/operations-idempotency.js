import crypto from 'node:crypto';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_TTL_MS = Number(process.env.SRA_IDEMPOTENCY_TTL_MS || 15 * 60 * 1000);
const completed = new Map();
const inFlight = new Map();

function isProtectedOperationsPath(path) {
  return [
    '/api/funding',
    '/api/funding-verification',
    '/api/funding-value',
    '/api/funding-model',
    '/api/funding-instrument',
    '/api/funding-instrument-review',
    '/api/funding-instrument-issuance',
    '/api/funding-marketplace',
    '/api/funding-marketplace-publication',
    '/api/funding-marketplace-commitment',
    '/api/funding-marketplace-allocation',
    '/api/funding-marketplace-settlement',
    '/api/funding-operations',
    '/api/sain/intelligence',
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      if (key !== 'actorId') acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function fingerprint(req) {
  return crypto.createHash('sha256').update(JSON.stringify({
    method: req.method,
    path: req.path,
    body: stable(req.body || {}),
    actorId: req.get('x-sra-actor-id') || req.body?.actorId || null,
  })).digest('hex');
}

function cleanup() {
  const cutoff = Date.now() - DEFAULT_TTL_MS;
  for (const [key, entry] of completed.entries()) {
    if (entry.completedAt < cutoff) completed.delete(key);
  }
}

export function operationsIdempotency(req, res, next) {
  if (!WRITE_METHODS.has(req.method) || !isProtectedOperationsPath(req.path)) return next();
  cleanup();

  const suppliedKey = String(req.get('x-sra-idempotency-key') || '').trim();
  const key = suppliedKey || fingerprint(req);
  const currentFingerprint = fingerprint(req);
  const previous = completed.get(key);

  if (previous) {
    if (previous.fingerprint !== currentFingerprint) {
      return res.status(409).json({
        error: 'The idempotency key has already been used for a different request.',
        code: 'SRA_IDEMPOTENCY_KEY_CONFLICT',
      });
    }
    res.set('x-sra-idempotent-replay', 'true');
    return res.status(previous.statusCode).json(previous.body);
  }

  if (inFlight.has(key)) {
    return res.status(409).json({
      error: 'An identical operation is already being processed.',
      code: 'SRA_OPERATION_IN_PROGRESS',
      retryAfterMs: 500,
    });
  }

  inFlight.set(key, { startedAt: Date.now(), fingerprint: currentFingerprint });
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const statusCode = res.statusCode || 200;
    if (statusCode >= 200 && statusCode < 300) {
      completed.set(key, { fingerprint: currentFingerprint, statusCode, body, completedAt: Date.now() });
      res.set('x-sra-idempotency-key', key);
    }
    inFlight.delete(key);
    return originalJson(body);
  };
  res.on('close', () => inFlight.delete(key));
  res.on('finish', () => inFlight.delete(key));
  req.sraIdempotencyKey = key;
  return next();
}
