import crypto from 'node:crypto';
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
  res.setHeader('Set-Cookie', `sra_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${secure}`);
}
function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', 'sra_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}
function hasAdminCapacity(subject) {
  return Boolean(subject?.capacities?.some((capacity) => (typeof capacity === 'string' ? capacity : capacity.id) === 'PLATFORM_ADMIN'));
}
function isDemoIdentity(subject) {
  return String(subject?.email || '').toLowerCase().endsWith('@sra.demo');
}
function isRealAdministrator(subject) {
  return hasAdminCapacity(subject) && !isDemoIdentity(subject);
}
function count(domain, type) { return domain.list(type).length; }
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createPrivateAdminRouter({ database, domain, coinbasePublicMarket = null }) {
  const access = new AccessService({ database });
  await access.initialize();
  const router = Router();
  router.use(express.json({ limit: '256kb' }));

  async function persistedUsers() {
    return database ? database.listUsers() : [...access.users.values()];
  }
  async function realAdministrators() {
    return (await persistedUsers()).filter(isRealAdministrator);
  }
  async function bootstrapState() {
    const administrators = await realAdministrators();
    return {
      initialized: administrators.length > 0,
      setupAvailable: administrators.length === 0 && Boolean(process.env.SRA_ADMIN_SETUP_CODE),
      setupCodeConfigured: Boolean(process.env.SRA_ADMIN_SETUP_CODE),
      administratorCount: administrators.length
    };
  }
  async function adminSession(req) {
    const session = await access.getSession(readCookie(req, 'sra_admin_session'));
    return session?.activeCapacity === 'PLATFORM_ADMIN' && isRealAdministrator(session) ? session : null;
  }
  async function requireAdmin(req, res) {
    const session = await adminSession(req);
    if (!session) res.status(401).json({ error: 'Private Platform Administration authentication is required.' });
    return session;
  }

  router.get('/api/admin/bootstrap-status', async (_req, res) => {
    return res.json({ ...(await bootstrapState()), portal: 'PRIVATE_PLATFORM_ADMINISTRATION' });
  });

  router.post('/api/admin/bootstrap', async (req, res) => {
    try {
      const state = await bootstrapState();
      if (state.initialized) return res.status(409).json({ error: 'Platform Administration has already been initialized.' });
      if (!state.setupCodeConfigured) return res.status(503).json({ error: 'One-time administrator setup is not enabled. Configure SRA_ADMIN_SETUP_CODE in Railway.' });
      if (!safeEqual(req.body?.setupCode, process.env.SRA_ADMIN_SETUP_CODE)) return res.status(403).json({ error: 'The one-time setup code is incorrect.' });
      if (String(req.body?.password || '') !== String(req.body?.confirmPassword || '')) return res.status(400).json({ error: 'Password confirmation does not match.' });
      const user = await access.createUser({
        displayName: req.body?.displayName,
        email: req.body?.email,
        password: req.body?.password,
        capacities: ['UNIVERSAL', 'PLATFORM_ADMIN']
      });
      if (database) await database.audit({ actorId: user.id, eventType: 'PLATFORM_ADMINISTRATION_INITIALIZED', objectType: 'PLATFORM_ADMIN', objectId: user.id });
      const result = await access.signin({ email: user.email, password: req.body?.password });
      const session = await access.switchRole(result.token, 'PLATFORM_ADMIN');
      setAdminCookie(res, result.token);
      return res.status(201).json({ initialized: true, authenticated: true, session, portal: 'PRIVATE_PLATFORM_ADMINISTRATION' });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Platform Administration initialization failed.' });
    }
  });

  router.post('/api/admin/signin', async (req, res) => {
    try {
      const state = await bootstrapState();
      if (!state.initialized) return res.status(409).json({ error: 'Create the first Platform Administrator before signing in.', requiresInitialization: true });
      const result = await access.signin(req.body || {});
      if (!isRealAdministrator(result.session)) {
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
    return res.json({ authenticated: Boolean(session), session, bootstrap: await bootstrapState(), portal: 'PRIVATE_PLATFORM_ADMINISTRATION' });
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
