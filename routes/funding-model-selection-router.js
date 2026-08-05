import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'FUNDING_MODEL_SELECTION_ERROR' });
}

export function createFundingModelSelectionRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/selections', (req, res) => {
    res.json({ records: service.listSelections({ opportunityId: req.query.opportunityId, status: req.query.status }) });
  });

  router.get('/selections/:selectionId', (req, res) => {
    const record = service.getSelection(req.params.selectionId);
    if (!record) return res.status(404).json({ error: 'Funding model selection was not found.' });
    return res.json(record);
  });

  router.post('/opportunities/:opportunityId/selections', async (req, res) => {
    try { return res.status(201).json(await service.selectModel(req.params.opportunityId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/instrument-requests', (req, res) => {
    res.json({ records: service.listInstrumentRequests(req.query.selectionId || null) });
  });

  router.post('/selections/:selectionId/instrument-request', async (req, res) => {
    try { return res.status(201).json(await service.createInstrumentSelectionRequest(req.params.selectionId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
