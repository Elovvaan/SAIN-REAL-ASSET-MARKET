import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'FUNDING_INSTRUMENT_SELECTION_ERROR' });
}

export function createFundingInstrumentSelectionRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/requests/:requestId/assessment', (req, res) => {
    try { return res.json(service.assess(req.params.requestId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/requests/:requestId/assessments', (req, res) => {
    try { return res.json({ records: service.listAssessments(req.params.requestId) }); }
    catch (error) { return handle(res, error); }
  });

  router.post('/requests/:requestId/assessment', async (req, res) => {
    try { return res.status(201).json(await service.saveAssessment(req.params.requestId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/requests/:requestId/selection', async (req, res) => {
    try { return res.status(201).json(await service.selectInstrumentFamily(req.params.requestId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/selections/:selectionId', (req, res) => {
    const record = service.getSelection(req.params.selectionId);
    if (!record) return res.status(404).json({ error: 'Instrument selection was not found.' });
    return res.json(record);
  });

  router.post('/selections/:selectionId/draft-instrument', async (req, res) => {
    try { return res.status(201).json(await service.createDraftInstrument(req.params.selectionId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
