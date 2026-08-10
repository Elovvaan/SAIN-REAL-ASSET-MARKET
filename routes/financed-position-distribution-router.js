import express from 'express';

function actorId(req) { return req.sraIdentity?.actorId || req.get('x-sra-actor-id') || req.body?.actorId || null; }
function handle(res, error) {
  const status = error.code === 'POSITION_DISTRIBUTION_INELIGIBLE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'FINANCED_POSITION_DISTRIBUTION_ERROR', assessment: error.assessment || null });
}

export function createFinancedPositionDistributionRouter(service) {
  const router = express.Router();
  router.get('/status', (_req, res) => res.json(service.status()));
  router.get('/positions', (req, res) => res.json({ records: service.listPositions({ status: req.query.status, distributionStatus: req.query.distributionStatus, opportunityId: req.query.opportunityId }) }));
  router.get('/positions/:positionId', (req, res) => { const detail = service.detail(req.params.positionId); return detail ? res.json(detail) : res.status(404).json({ error: 'Financed position was not found.' }); });
  router.get('/positions/:positionId/distribution-assessment', (req, res) => { try { return res.json(service.assessDistributionEligibility(req.params.positionId)); } catch (error) { return handle(res, error); } });
  router.post('/positions/:positionId/make-available', async (req, res) => { try { return res.status(201).json(await service.makeAvailable(req.params.positionId, req.body || {}, actorId(req))); } catch (error) { return handle(res, error); } });
  return router;
}