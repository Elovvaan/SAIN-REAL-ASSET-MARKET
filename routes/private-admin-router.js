import express, { Router } from 'express';
import { AccessService } from '../services/access-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sra_admin_session=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=14400${secure}`);
}
function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', 'sra_admin_session=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0');
}
function hasAdminCapacity(session) {
  return Boolean(session?.capacities?.some((capacity) => capacity.id === 'PLATFORM_ADMIN'));
}
function count(domain, type) { return domain.list(type).length; }

export async function createPrivateAdminRouter({ database, domain, coinbasePublicMarket = null }) {
  const access = new AccessService({ database });
  await access.initialize();
  const router = Router();
  router.use(express.json({ limit: '256kb' }));

  async function adminSession(req) {
    const session = await access.getSession(readCookie(req, 'sra_admin_session'));
    return session?.activeCapacity === 'PLATFORM_ADMIN' && hasAdminCapacity(session) ? session : null;
  }
  async function requireAdmin(req, res) {
    const session = await adminSession(req);
    if (!session) res.status(401).json({ error: 'Private Platform Administration authentication is required.' });
    return session;
  }

  router.post('/api/admin/signin', async (req, res) => {
    try {
      const result = await access.signin(req.body || {});
      if (!hasAdminCapacity(result.session)) {
        await access.signout(result.token);
        return res.status(403).json({ error: 'This identity is not authorized for Platform Administration.' });
      }
      const session = await access.switchRole(result.token, 'PLATFORM_ADMIN');
      setAdminCookie(res, result.token);
      return res.json({ authenticated: true, session, portal: 'PRIVATE_PLATFORM_ADMINISTRATION' });
    } catch (error) {
      return res.status(401).json({ error: error.message || 'Administrator sign-in failed.' });
    }
  });

  router.get('/api/admin/session', async (req, res) => {
    const session = await adminSession(req);
    return res.json({ authenticated: Boolean(session), session, portal: 'PRIVATE_PLATFORM_ADMINISTRATION' });
  });

  router.post('/api/admin/signout', async (req, res) => {
    await access.signout(readCookie(req, 'sra_admin_session'));
    clearAdminCookie(res);
    return res.json({ signedOut: true });
  });

  router.get('/api/admin/summary', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const coinbase = coinbasePublicMarket?.status?.() || null;
    return res.json({
      generatedAt: new Date().toISOString(),
      administrator: { id: session.id, displayName: session.displayName, capacity: session.activeCapacity },
      platform: {
        observations: count(domain, RECORD_TYPES.MARKET_OBSERVATION),
        recognitionAssessments: count(domain, RECORD_TYPES.RECOGNITION_ASSESSMENT),
        financialRecords: count(domain, RECORD_TYPES.FINANCIAL_RECORD),
        coinPositions: count(domain, RECORD_TYPES.COIN_POSITION),
        instruments: count(domain, RECORD_TYPES.SRA_INSTRUMENT),
        transactions: count(domain, RECORD_TYPES.SRA_TRANSACTION),
        fundingInstructions: count(domain, RECORD_TYPES.FUNDING_INSTRUCTION),
        treasuryWallets: count(domain, RECORD_TYPES.TREASURY_CRYPTO_WALLET),
        treasuryActivity: count(domain, RECORD_TYPES.TREASURY_CRYPTO_ACTIVITY)
      },
      connectors: { coinbasePublicMarket: coinbase },
      approvalBoundary: {
        agentWriteAccess: 'DISABLED',
        stateChangesRequireApproval: true,
        protectedAreas: ['FINANCIAL_RECORDS','RECOGNITION','COIN_POSITIONS','INSTRUMENTS','TRANSACTIONS','TREASURY','SETTLEMENT','CONNECTORS','ACCOUNT_AUTHORITY']
      }
    });
  });

  router.use('/admin', express.static(new URL('../public/admin', import.meta.url).pathname, { index: 'index.html' }));
  return router;
}

export async function rejectPlatformAdminPublicSignin(req, res, next, database) {
  if (req.method !== 'POST' || req.path !== '/api/access/signin') return next();
  const access = new AccessService({ database });
  await access.initialize();
  try {
    const result = await access.signin(req.body || {});
    const isAdmin = hasAdminCapacity(result.session);
    await access.signout(result.token);
    if (isAdmin) return res.status(403).json({ error: 'Platform Administration identities must sign in through the private administration portal.' });
  } catch {
    // Let the normal public sign-in endpoint return its standard credential response.
  }
  return next();
}
