import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = error.code === 'MARKETPLACE_PREPARATION_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_MARKETPLACE_PREPARATION_ERROR',
    assessment: error.assessment || null,
  });
}

export function createFundingMarketplacePreparationRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/instruments/:instrumentId/assessment', (req, res) => {
    try { return res.json(service.assessInstrument(req.params.instrumentId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/preparations', (req, res) => {
    res.json({ records: service.listPreparations({ instrumentId: req.query.instrumentId, status: req.query.status }) });
  });

  router.get('/preparations/:preparationId', (req, res) => {
    const record = service.getPreparation(req.params.preparationId);
    if (!record) return res.status(404).json({ error: 'Marketplace preparation record was not found.' });
    return res.json(record);
  });

  router.post('/instruments/:instrumentId/preparations', async (req, res) => {
    try { return res.status(201).json(await service.createPreparation(req.params.instrumentId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/preparations/:preparationId/assessment', (req, res) => {
    try { return res.json(service.assessPreparation(req.params.preparationId)); }
    catch (error) { return handle(res, error); }
  });

  router.post('/preparations/:preparationId/review', async (req, res) => {
    try { return res.status(201).json(await service.review(req.params.preparationId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/preparations/:preparationId/listing', async (req, res) => {
    try { return res.status(201).json(await service.createPreparedListing(req.params.preparationId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
