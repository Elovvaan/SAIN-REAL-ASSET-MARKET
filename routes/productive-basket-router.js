import { Router } from 'express';
import { submitFinancedPositionAdmission, decideFinancedPositionAdmission } from '../services/financed-position-basket-bridge-service.js';

function readCookie(req, name) {
  const entry = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function fail(res, error) {
  const message = error?.message || 'Productive basket operation failed.';
  const status = /not found/i.test(message) ? 404 : /not available|authorization/i.test(message) ? 403 : /already|exceed|insufficient|state/i.test(message) ? 409 : 400;
  return res.status(status).json({ error: message });
}

export function createProductiveBasketRouter(service, directAccounts, accessService) {
  const router = Router();
  const session = (req) => accessService.getSession(readCookie(req, 'sra_session'));
  async function requireSession(req, res) {
    const current = await session(req);
    if (!current) res.status(401).json({ error: 'Authentication required.' });
    return current;
  }
  const actor = (current) => ({ participantId: current.id, capacity: current.activeCapacity });

  router.get('/', (_req, res) => res.json({ baskets: service.list(_req.query) }));
  router.get('/me/positions', async (req, res) => {
    const current = await requireSession(req, res); if (!current) return;
    return res.json({ positions: service.participantPositions(current.id) });
  });
  router.get('/:basketId', (req, res) => {
    const detail = service.detail(req.params.basketId);
    return detail ? res.json(detail) : res.status(404).json({ error: 'Productive basket not found.' });
  });
  router.post('/', async (req, res) => {
    try { const current = await requireSession(req, res); if (!current) return; return res.status(201).json(await service.create(req.body, actor(current))); }
    catch (error) { return fail(res, error); }
  });
  router.post('/:basketId/admissions', async (req, res) => {
    try {
      const current = await requireSession(req, res); if (!current) return;
      const result = req.body?.financedPositionId
        ? await submitFinancedPositionAdmission(service, req.params.basketId, req.body, actor(current))
        : await service.submitAsset(req.params.basketId, req.body, actor(current));
      return res.status(201).json(result);
    }
    catch (error) { return fail(res, error); }
  });
  router.post('/admissions/:admissionId/decision', async (req, res) => {
    try {
      const current = await requireSession(req, res); if (!current) return;
      const admission = service.domain.get('BASKET_ASSET_ADMISSION', req.params.admissionId);
      const result = admission?.linkageType === 'FINANCED_POSITION'
        ? await decideFinancedPositionAdmission(service, req.params.admissionId, req.body, actor(current))
        : await service.decideAdmission(req.params.admissionId, req.body, actor(current));
      return res.json(result);
    }
    catch (error) { return fail(res, error); }
  });
  router.post('/:basketId/contributions', async (req, res) => {
    try {
      const current = await requireSession(req, res); if (!current) return;
      const account = await directAccounts.ensureAccount({ participantId: current.id, universalAccountId: current.universalAccountId, displayName: current.displayName }, current.id);
      return res.status(201).json(await service.contribute(req.params.basketId, { ...req.body, directValueAccountId: req.body?.directValueAccountId || account.directValueAccountId }, actor(current)));
    } catch (error) { return fail(res, error); }
  });
  for (const [path, method] of [['close', 'closeFormation'], ['performance', 'recordPerformance'], ['distributions', 'distribute'], ['reconstitutions', 'reconstitute']]) {
    router.post(`/:basketId/${path}`, async (req, res) => {
      try { const current = await requireSession(req, res); if (!current) return; return res.status(201).json(await service[method](req.params.basketId, req.body, actor(current))); }
      catch (error) { return fail(res, error); }
    });
  }
  return router;
}
