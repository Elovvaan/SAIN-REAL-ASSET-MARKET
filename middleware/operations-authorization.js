const STAFF_ROLES = new Set([
  'PLATFORM_ADMIN',
  'OPERATIONS_ADMIN',
  'FUNDING_OPERATIONS',
  'FUNDING_ANALYST',
  'VERIFICATION_REVIEWER',
  'INSTRUMENT_REVIEWER',
  'ISSUANCE_REVIEWER',
  'MARKETPLACE_OPERATOR',
  'SETTLEMENT_OPERATOR',
  'AUDITOR',
]);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseRoles(req) {
  const header = req.get('x-sra-roles') || req.get('x-sra-role') || '';
  const bodyRole = req.body?.role || req.body?.capacity || '';
  return [...new Set(`${header},${bodyRole}`
    .split(',')
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean))];
}

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

function isReadOnlyIntelligenceRequest(req) {
  return req.path.startsWith('/api/sain/intelligence') && req.method === 'GET';
}

export function authorizeOperationsRequest(req, res, next) {
  if (!isProtectedOperationsPath(req.path)) return next();
  if (!WRITE_METHODS.has(req.method)) return next();
  if (isReadOnlyIntelligenceRequest(req)) return next();

  const roles = parseRoles(req);
  const allowed = roles.some((role) => STAFF_ROLES.has(role));
  if (!allowed) {
    return res.status(403).json({
      error: 'This operation requires an authorized SRA staff role.',
      code: 'SRA_OPERATIONS_ROLE_REQUIRED',
      requiredRoles: [...STAFF_ROLES],
    });
  }

  req.sraOperationsAuth = {
    actorId: req.get('x-sra-actor-id') || req.body?.actorId || null,
    roles,
  };
  return next();
}

export { STAFF_ROLES as SRA_OPERATIONS_STAFF_ROLES };
