import express from 'express';

function actorId(req) {
  return req.sraIdentity?.actorId || req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'FINANCING_LIFECYCLE_ERROR' });
}

export function createFinancingLifecycleRouter(service) {
  const router = express.Router();

  router.get('/opportunities/:opportunityId', async (req, res) => {
    try {
      const record = await service.ensure(req.params.opportunityId, actorId(req));
      return res.json({ opportunityId: record.opportunityId, financingStage: record.financingStage, financingHistory: record.financingHistory || [], record });
    } catch (error) { return handle(res, error); }
  });

  router.post('/opportunities/:opportunityId/transition', async (req, res) => {
    try {
      const updated = await service.transition(req.params.opportunityId, req.body?.toStage, {
        reason: req.body?.reason || null,
        source: req.body?.source || 'FINANCING_WORKFLOW',
        referenceId: req.body?.referenceId || null,
      }, actorId(req));
      return res.json({ opportunityId: updated.opportunityId, financingStage: updated.financingStage, financingHistory: updated.financingHistory || [] });
    } catch (error) { return handle(res, error); }
  });

  return router;
}
