import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = error.code === 'PROJECTION_INELIGIBLE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'ON_CHAIN_PROJECTION_ERROR', assessment: error.assessment || null });
}

export function createOnChainProjectionRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/eligibility/:instrumentId', (req, res) => {
    res.json(service.evaluateInstrument(req.params.instrumentId));
  });

  router.get('/projections', (req, res) => {
    res.json({ records: service.listProjections({ status: req.query.status, instrumentId: req.query.instrumentId, network: req.query.network }) });
  });

  router.get('/projections/:projectionId', (req, res) => {
    const record = service.getProjection(req.params.projectionId);
    if (!record) return res.status(404).json({ error: 'Projection not found.' });
    return res.json(record);
  });

  router.post('/projections', async (req, res) => {
    try { return res.status(201).json(await service.createProjection(req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/projections/:projectionId/approve', async (req, res) => {
    try { return res.json(await service.approveProjection(req.params.projectionId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/projections/:projectionId/mint', async (req, res) => {
    try { return res.status(201).json(await service.createMint(req.params.projectionId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/projections/:projectionId/allocate', async (req, res) => {
    try { return res.status(201).json(await service.allocate(req.params.projectionId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/wallets', (req, res) => {
    res.json({ records: service.listWallets({ participantId: req.query.participantId, status: req.query.status }) });
  });

  router.post('/wallets', async (req, res) => {
    try { return res.status(201).json(await service.registerWallet(req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/wallets/:walletId/approve', async (req, res) => {
    try { return res.json(await service.approveWallet(req.params.walletId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/events', (req, res) => res.json({ records: service.listChainEvents(req.query.projectionId || null) }));

  router.post('/events', async (req, res) => {
    try { return res.status(201).json(await service.recordChainEvent(req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/events/:eventId/reconcile', async (req, res) => {
    try { return res.json(await service.reconcileEvent(req.params.eventId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/reconciliations', (req, res) => res.json({ records: service.listReconciliations(req.query.projectionId || null) }));

  return router;
}
