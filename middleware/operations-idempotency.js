import crypto from 'node:crypto';
import { DatabaseService } from '../services/database-service.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_TTL_MS = Number(process.env.SRA_IDEMPOTENCY_TTL_MS || 15 * 60 * 1000);
let databasePromise = null;

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

function actorId(req) {
  return req.sraOperationsAuth?.actorId || req.sraIdentity?.actorId || null;
}

function fingerprint(req) {
  return crypto.createHash('sha256').update(JSON.stringify({
    method: req.method,
    path: req.path,
    body: stable(req.body || {}),
    actorId: actorId(req),
  })).digest('hex');
}

function resourceKey(req, currentFingerprint) {
  const identifiers = [
    'opportunityId', 'verificationRequestId', 'preparationId', 'selectionId',
    'instrumentSelectionRequestId', 'instrumentSelectionId', 'instrumentId',
    'reviewId', 'issuanceRequestId', 'issuanceReviewId', 'issuanceAuthorizationId',
    'marketplacePreparationId', 'publicationReviewId', 'publicationAuthorizationId',
    'listingId', 'windowId', 'commitmentId', 'allocationReviewId', 'positionId',
    'settlementPreparationId', 'settlementReviewId', 'settlementAuthorizationId',
  ];
  const bodyId = identifiers.map((field) => req.body?.[field]).find(Boolean);
  const pathId = req.path.split('/').find((segment) => /^[A-Za-z]{1,20}-[A-Za-z0-9-]{2,}$/.test(segment));
  return `SRA:${bodyId || pathId || `${actorId(req) || 'anonymous'}:${currentFingerprint}`}`;
}

async function defaultDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = new DatabaseService();
      await database.initialize();
      return database;
    })();
  }
  return databasePromise;
}

export function createOperationsIdempotency({ databaseProvider = defaultDatabase } = {}) {
  return async function operationsIdempotency(req, res, next) {
    if (!WRITE_METHODS.has(req.method) || !isProtectedOperationsPath(req.path)) return next();

    const suppliedKey = String(req.get('x-sra-idempotency-key') || '').trim();
    const currentFingerprint = fingerprint(req);
    const key = suppliedKey || currentFingerprint;
    const resource = resourceKey(req, currentFingerprint);

    try {
      const database = await databaseProvider();
      const claim = await database.claimIdempotency({
        key,
        fingerprint: currentFingerprint,
        actorId: actorId(req),
        resourceKey: resource,
        ttlMs: DEFAULT_TTL_MS,
      });

      if (claim.state === 'CONFLICT') {
        return res.status(409).json({ error: 'The idempotency key has already been used for a different request.', code: 'SRA_IDEMPOTENCY_KEY_CONFLICT' });
      }
      if (claim.state === 'REPLAY') {
        res.set('x-sra-idempotent-replay', 'true');
        res.set('x-sra-idempotency-key', key);
        return res.status(claim.statusCode || 200).json(claim.body);
      }
      if (claim.state === 'IN_PROGRESS') {
        return res.status(409).json({ error: 'An identical operation is already being processed.', code: 'SRA_OPERATION_IN_PROGRESS', retryAfterMs: 500 });
      }
      if (claim.state === 'RESOURCE_BUSY') {
        return res.status(409).json({ error: 'Another operation is currently changing the same SRA resource.', code: 'SRA_RESOURCE_OPERATION_IN_PROGRESS', resourceKey: claim.resourceKey, retryAfterMs: 500 });
      }

      let finalized = false;
      let finalizing = false;
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (finalizing || finalized) return res;
        finalizing = true;
        const statusCode = res.statusCode || 200;
        void (async () => {
          try {
            if (statusCode >= 200 && statusCode < 300) {
              const stored = await database.completeIdempotency({ key, fingerprint: currentFingerprint, statusCode, body });
              if (!stored) throw new Error('Durable idempotency record was not completed.');
              res.set('x-sra-idempotency-key', key);
            } else {
              await database.releaseIdempotency(key);
            }
            finalized = true;
            originalJson(body);
          } catch (error) {
            console.error('Durable idempotency finalization failed:', error);
            await database.releaseIdempotency(key).catch(() => {});
            if (!res.headersSent) res.status(503);
            finalized = true;
            originalJson({ error: 'SRA could not durably finalize this operation.', code: 'SRA_TRANSACTION_FINALIZATION_FAILED' });
          }
        })();
        return res;
      };

      const releaseUnfinished = () => {
        if (!finalized && !finalizing) database.releaseIdempotency(key)
          .catch((error) => console.error('Durable idempotency cleanup failed:', error));
      };
      res.once('close', releaseUnfinished);
      res.once('finish', releaseUnfinished);
      req.sraIdempotencyKey = key;
      req.sraOperationResourceKey = resource;
      return next();
    } catch (error) {
      console.error('Durable idempotency claim failed:', error);
      return res.status(503).json({ error: 'SRA could not secure this operation for durable processing.', code: 'SRA_TRANSACTION_SAFETY_UNAVAILABLE' });
    }
  };
}

export const operationsIdempotency = createOperationsIdempotency();
