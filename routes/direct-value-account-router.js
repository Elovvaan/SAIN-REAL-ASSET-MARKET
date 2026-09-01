import { Router } from 'express';

function readCookie(req, name) {
  const entry = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function actorId(req) { return req.sraOperationsAuth?.actorId || req.sraIdentity?.actorId || req.headers['x-sra-actor-id'] || null; }
function fail(res, error) {
  const message = error?.message || 'Direct Value Account operation failed.';
  const status = /not found/i.test(message) ? 404 : /authorization|required.*authority/i.test(message) ? 403 : /already|exceed|insufficient/i.test(message) ? 409 : 400;
  return res.status(status).json({ error: message });
}

export function createDirectValueAccountRouter(service, accessService) {
  const router = Router();
  async function session(req) { return accessService.getSession(readCookie(req, 'sra_session')); }
  async function requireSession(req, res) {
    const current = await session(req);
    if (!current) res.status(401).json({ error: 'Authentication required.' });
    return current;
  }
  async function requireAdmin(req, res) {
    const current = await requireSession(req, res);
    if (!current) return null;
    if (current.activeCapacity !== 'PLATFORM_ADMIN') { res.status(403).json({ error: 'Platform Administration authorization is required.' }); return null; }
    return current;
  }

  router.get('/me', async (req, res) => {
    try {
      const current = await requireSession(req, res); if (!current) return;
      const account = await service.ensureAccount({ participantId: current.id, universalAccountId: current.universalAccountId, displayName: current.displayName }, current.id);
      return res.json(service.snapshot(account.directValueAccountId));
    } catch (error) { return fail(res, error); }
  });

  router.post('/admin/funding-credits', async (req, res) => {
    try {
      const current = await requireAdmin(req, res); if (!current) return;
      return res.status(201).json(await service.creditAuthorizedFunding(req.body || {}, current.id));
    } catch (error) { return fail(res, error); }
  });

  router.post('/admin/external-deposits', async (req, res) => {
    try {
      const current = await requireAdmin(req, res); if (!current) return;
      return res.status(201).json(await service.recordExternalDeposit(req.body || {}, current.id));
    } catch (error) { return fail(res, error); }
  });

  router.post('/admin/rail-representations', async (req, res) => {
    try {
      const current = await requireAdmin(req, res); if (!current) return;
      return res.status(201).json(await service.registerRailRepresentation(req.body || {}, current.id));
    } catch (error) { return fail(res, error); }
  });

  router.post('/admin/rail-movements', async (req, res) => {
    try {
      const current = await requireAdmin(req, res); if (!current) return;
      return res.status(201).json(await service.recordConfirmedRailMovement(req.body || {}, current.id));
    } catch (error) { return fail(res, error); }
  });

  router.post('/admin/conversions', async (req, res) => {
    try {
      const current = await requireAdmin(req, res); if (!current) return;
      return res.status(201).json(await service.convert(req.body || {}, current.id));
    } catch (error) { return fail(res, error); }
  });

  router.post('/admin/repayments', async (req, res) => {
    try {
      const current = await requireAdmin(req, res); if (!current) return;
      return res.status(201).json(await service.recordRepayment(req.body || {}, current.id));
    } catch (error) { return fail(res, error); }
  });

  router.post('/admin/obligation-releases', async (req, res) => {
    try {
      const current = await requireAdmin(req, res); if (!current) return;
      return res.status(201).json(await service.releaseObligation(req.body || {}, current.id));
    } catch (error) { return fail(res, error); }
  });

  router.get('/admin/accounts/:directValueAccountId', async (req, res) => {
    try {
      const current = await requireAdmin(req, res); if (!current) return;
      return res.json(service.snapshot(req.params.directValueAccountId));
    } catch (error) { return fail(res, error); }
  });

  return router;
}
