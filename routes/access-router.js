import { Router } from 'express';
import { AccessService } from '../services/access-service.js';

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sra_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`);
}
function clearSessionCookie(res) { res.setHeader('Set-Cookie', 'sra_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }
function amount(value) { const parsed = Number(value); return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0; }
function isCompleted(transaction) {
  return ['COMPLETED', 'SETTLED', 'POSTED', 'EXECUTED', 'EVIDENCED', 'VERIFIED', 'CLOSED']
    .some((state) => String(transaction.state || '').toUpperCase().includes(state));
}
function isPending(transaction) {
  return ['PENDING', 'QUEUED', 'AUTHORIZED', 'SUBMITTED', 'PROCESSING', 'AVAILABLE']
    .some((state) => String(transaction.state || '').toUpperCase().includes(state));
}
function participantVault(session, transactions = []) {
  const identityKeys = new Set([session.id, session.universalAccountId].filter(Boolean));
  const linked = transactions.filter((transaction) => [
    transaction.participantId,
    transaction.fromAccountId,
    transaction.toAccountId
  ].some((value) => value && identityKeys.has(value)));

  let incoming = 0;
  let outgoing = 0;
  const activity = linked.map((transaction) => {
    const completed = isCompleted(transaction);
    const incomingMatch = transaction.toAccountId && identityKeys.has(transaction.toAccountId);
    const outgoingMatch = transaction.fromAccountId && identityKeys.has(transaction.fromAccountId);
    let direction = 'RECORDED';
    if (incomingMatch && !outgoingMatch) direction = 'INCOMING';
    if (outgoingMatch && !incomingMatch) direction = 'OUTGOING';
    if (incomingMatch && outgoingMatch) direction = 'INTERNAL';
    if (completed && direction === 'INCOMING') incoming += amount(transaction.amount);
    if (completed && direction === 'OUTGOING') outgoing += amount(transaction.amount);
    return { ...transaction, direction, completed };
  });

  const completed = activity.filter((transaction) => transaction.completed);
  const pending = activity.filter(isPending);
  const verified = activity.filter((transaction) => transaction.verified);

  return {
    accountId: session.universalAccountId,
    participantId: session.id,
    displayName: session.displayName,
    activeCapacity: session.activeCapacity,
    ownership: 'PARTICIPANT',
    platformRole: 'INFRASTRUCTURE',
    custodyState: 'NOT_INFERRED',
    currency: 'USD',
    recordedBalance: amount(incoming - outgoing),
    incomingTotal: amount(incoming),
    outgoingTotal: amount(outgoing),
    transactionCount: activity.length,
    completedTransactionCount: completed.length,
    pendingTransactionCount: pending.length,
    verifiedTransactionCount: verified.length,
    transactions: activity.slice(0, 50)
  };
}

export function createAccessRouter(marketplace, service = new AccessService()) {
  const router = Router();
  router.get('/public', (_req, res) => res.json({
    marketStatus: marketplace.marketStatus,
    verifiedValue: marketplace.verifiedValue,
    activeProjects: marketplace.activeProjects,
    participatingAssets: marketplace.participatingAssets,
    opportunities: marketplace.projects.map((project) => ({
      id: project.id, title: project.title, assetName: project.assetName, region: project.region,
      stage: project.stage, signal: project.signal, verifiedValue: project.verifiedValue,
      projectedGainRate: project.projectedGainRate, participationWindow: project.participationWindow,
      completionState: project.completionState
    }))
  }));
  router.get('/session', async (req, res) => {
    try {
      const session = await service.getSession(readCookie(req, 'sra_session'));
      res.json({ authenticated: Boolean(session), session });
    } catch (error) { res.status(500).json({ error: 'Session lookup failed.' }); }
  });
  router.get('/vault', async (req, res) => {
    try {
      const session = await service.getSession(readCookie(req, 'sra_session'));
      if (!session) return res.status(401).json({ error: 'Authentication required.' });
      return res.json({ vault: participantVault(session, marketplace.transactions || []) });
    } catch (error) { return res.status(500).json({ error: 'Asset Vault lookup failed.' }); }
  });
  router.post('/signup', async (req, res) => {
    try { const result = await service.signup(req.body); setSessionCookie(res, result.token); res.status(201).json({ authenticated: true, session: result.session }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/signin', async (req, res) => {
    try { const result = await service.signin(req.body); setSessionCookie(res, result.token); res.json({ authenticated: true, session: result.session }); }
    catch (error) { res.status(401).json({ error: error.message }); }
  });
  router.post('/signout', async (req, res) => {
    await service.signout(readCookie(req, 'sra_session'));
    clearSessionCookie(res);
    res.json({ authenticated: false });
  });
  router.post('/role', async (req, res) => {
    try { const session = await service.switchRole(readCookie(req, 'sra_session'), req.body?.role); res.json({ authenticated: true, session }); }
    catch (error) { res.status(403).json({ error: error.message }); }
  });
  router.post('/capacity/apply', async (req, res) => {
    try { const session = await service.applyForCapacity(readCookie(req, 'sra_session'), req.body?.capacity); res.status(202).json({ authenticated: true, session }); }
    catch (error) { res.status(403).json({ error: error.message }); }
  });
  router.post('/capacity/activate', async (req, res) => {
    try { const session = await service.activateCapacity(readCookie(req, 'sra_session'), req.body?.capacity); res.status(201).json({ authenticated: true, session }); }
    catch (error) { res.status(403).json({ error: error.message }); }
  });
  return router;
}
export { readCookie, participantVault };
