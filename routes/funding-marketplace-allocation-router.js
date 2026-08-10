import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = error.code === 'ALLOCATION_REVIEW_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_MARKETPLACE_ALLOCATION_ERROR',
    assessment: error.assessment || null,
  });
}

function normalizeDirectMount(req, _res, next) {
  const prefix = '/api/funding-marketplace-allocation';
  if (req.url === prefix) req.url = '/';
  else if (req.url.startsWith(`${prefix}/`)) req.url = req.url.slice(prefix.length);
  next();
}

export function createFundingMarketplaceAllocationRouter(service) {
  const router = express.Router();
  router.use(normalizeDirectMount);

  router.get('/status', (_req, res) => res.json(service.status()));

  router.post('/windows/:windowId/close', async (req, res) => {
    try { return res.json(await service.closeWindow(req.params.windowId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/windows/:windowId/assessment', (req, res) => {
    try { return res.json(service.assessWindow(req.params.windowId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/reviews', (req, res) => {
    res.json({ records: service.listReviews({ windowId: req.query.windowId, status: req.query.status }) });
  });

  router.get('/reviews/:reviewId', (req, res) => {
    const record = service.getReview(req.params.reviewId);
    if (!record) return res.status(404).json({ error: 'Allocation review was not found.' });
    return res.json(record);
  });

  router.post('/windows/:windowId/reviews', async (req, res) => {
    try { return res.status(201).json(await service.startReview(req.params.windowId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/reviews/:reviewId/decision', async (req, res) => {
    try { return res.json(await service.decide(req.params.reviewId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/reviews/:reviewId/positions', async (req, res) => {
    try { return res.status(201).json(await service.createPositions(req.params.reviewId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/positions', (req, res) => {
    res.json({ records: service.listPositions({ listingId: req.query.listingId, participantId: req.query.participantId, status: req.query.status }) });
  });

  router.get('/participation-agreements', (req, res) => {
    res.json({ records: service.listAgreements({ positionId: req.query.positionId, financedPositionId: req.query.financedPositionId, participantId: req.query.participantId, status: req.query.status }) });
  });

  router.get('/participation-agreements/:agreementId', (req, res) => {
    const record = service.getAgreement(req.params.agreementId);
    if (!record) return res.status(404).json({ error: 'Secondary participation agreement was not found.' });
    return res.json(record);
  });

  router.post('/positions/:positionId/participation-agreements', async (req, res) => {
    try { return res.status(201).json(await service.createParticipationAgreement(req.params.positionId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/participation-agreements/:agreementId/participant-acceptance', async (req, res) => {
    try { return res.json(await service.acceptParticipationAgreement(req.params.agreementId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/participation-agreements/:agreementId/execute', async (req, res) => {
    try { return res.json(await service.executeParticipationAgreement(req.params.agreementId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/positions/:positionId/settlement-preparation', async (req, res) => {
    try { return res.status(201).json(await service.prepareSettlement(req.params.positionId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/settlement-preparations', (req, res) => {
    res.json({ records: service.listSettlementPreparations({ positionId: req.query.positionId, status: req.query.status }) });
  });

  return router;
}
