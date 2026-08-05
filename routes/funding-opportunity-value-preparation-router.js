import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'FUNDING_VALUE_PREPARATION_ERROR' });
}

export function createFundingOpportunityValuePreparationRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/preparations', (req, res) => {
    res.json({ records: service.listPreparations({ opportunityId: req.query.opportunityId, status: req.query.status }) });
  });

  router.get('/preparations/:preparationId', (req, res) => {
    const record = service.getPreparation(req.params.preparationId);
    if (!record) return res.status(404).json({ error: 'Value preparation record was not found.' });
    return res.json(record);
  });

  router.post('/opportunities/:opportunityId/preparations', async (req, res) => {
    try { return res.status(201).json(await service.createPreparation(req.params.opportunityId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.patch('/preparations/:preparationId', async (req, res) => {
    try { return res.json(await service.updatePreparation(req.params.preparationId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/preparations/:preparationId/model-assessment', (req, res) => {
    try { return res.json(service.assessModels(req.params.preparationId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/preparations/:preparationId/model-assessments', (req, res) => {
    try {
      const preparation = service.getPreparation(req.params.preparationId);
      if (!preparation) return res.status(404).json({ error: 'Value preparation record was not found.' });
      return res.json({ records: service.listModelAssessments(req.params.preparationId) });
    } catch (error) { return handle(res, error); }
  });

  router.post('/preparations/:preparationId/model-assessment', async (req, res) => {
    try { return res.status(201).json(await service.saveModelAssessment(req.params.preparationId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/preparations/:preparationId/complete', async (req, res) => {
    try { return res.json(await service.completePreparation(req.params.preparationId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
