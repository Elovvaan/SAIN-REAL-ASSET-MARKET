const STAFF_CAPACITIES = new Set([
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

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function isProtectedPath(path) {
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
    '/api/production/audit',
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function requiredCapacityForPath(path) {
  if (path.startsWith('/api/production/audit')) return new Set(['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'AUDITOR']);
  if (path.startsWith('/api/funding-verification')) return new Set(['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_REVIEWER', 'FUNDING_OPERATIONS']);
  if (path.startsWith('/api/funding-instrument-review')) return new Set(['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'INSTRUMENT_REVIEWER', 'FUNDING_OPERATIONS']);
  if (path.startsWith('/api/funding-instrument-issuance')) return new Set(['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'ISSUANCE_REVIEWER', 'FUNDING_OPERATIONS']);
  if (path.startsWith('/api/funding-marketplace-settlement')) return new Set(['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'SETTLEMENT_OPERATOR']);
  if (path.startsWith('/api/funding-marketplace')) return new Set(['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'MARKETPLACE_OPERATOR', 'FUNDING_OPERATIONS']);
  if (path.startsWith('/api/sain/intelligence')) return STAFF_CAPACITIES;
  return new Set(['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'FUNDING_OPERATIONS', 'FUNDING_ANALYST']);
}

export function createServerSessionAuthorization(accessService) {
  if (!accessService) throw new Error('AccessService is required for server-trusted authorization.');

  return async function serverSessionAuthorization(req, res, next) {
    if (!isProtectedPath(req.path)) return next();
    if (!WRITE_METHODS.has(req.method) && !req.path.startsWith('/api/production/audit')) return next();

    try {
      const token = readCookie(req, 'sra_session');
      const session = await accessService.getSession(token);
      if (!session) {
        return res.status(401).json({
          error: 'An active authenticated SRA session is required.',
          code: 'SRA_AUTHENTICATION_REQUIRED',
        });
      }

      const serverCapacities = new Set([
        session.activeCapacity,
        ...(session.capacities || []).map((capacity) => capacity.id || capacity),
        ...(session.roles || []).map((role) => role.id || role),
      ].filter(Boolean).map((value) => String(value).toUpperCase()));

      const required = requiredCapacityForPath(req.path);
      const authorized = [...serverCapacities].some((capacity) => required.has(capacity));
      if (!authorized) {
        return res.status(403).json({
          error: 'The authenticated account is not authorized for this SRA operation.',
          code: 'SRA_SERVER_ROLE_REQUIRED',
          requiredRoles: [...required],
        });
      }

      req.sraIdentity = {
        actorId: session.id,
        universalAccountId: session.universalAccountId,
        email: session.email,
        activeCapacity: session.activeCapacity,
        capacities: [...serverCapacities],
      };
      req.sraOperationsAuth = {
        actorId: session.id,
        roles: [...serverCapacities],
        source: 'SERVER_SESSION',
      };
      return next();
    } catch (error) {
      return res.status(500).json({
        error: 'SRA could not validate the authenticated session.',
        code: 'SRA_SESSION_VALIDATION_FAILED',
      });
    }
  };
}

export { STAFF_CAPACITIES as SRA_SERVER_STAFF_CAPACITIES };
