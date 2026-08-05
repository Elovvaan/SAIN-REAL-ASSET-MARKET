import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = error.code === 'SETTLEMENT_REVIEW_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_MARKETPLACE_SETTLEMENT_ERROR',
    assessment: error.assessment || null,
  });
}

export function createFundingMarketplaceSettlementRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/preparations/:preparationId/assessment', (req, res) => {
    try { return res.json(service.assessPreparation(req.params.preparationId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/reviews', (req, res) => {
    res.json({ records: service.listReviews({ preparationId: req.query.preparationId, status: req.query.status }) });
  });

  router.get('/reviews/:reviewId', (req, res) => {
    const record = service.getReview(req.params.reviewId);
    if (!record) return res.status(404).json({ error: 'Settlement review was not found.' });
    return res.json(record);
  });

  router.post('/preparations/:preparationId/reviews', async (req, res) => {
    try { return res.status(201).json(await service.startReview(req.params.preparationId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/reviews/:reviewId/decision', async (req, res) => {
    try { return res.json(await service.decide(req.params.reviewId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/authorizations', (req, res) => {
    res.json({ records: service.listAuthorizations({ positionId: req.query.positionId, status: req.query.status }) });
  });

  router.post('/authorizations/:authorizationId/settle', async (req, res) => {
    try { return res.status(201).json(await service.settle(req.params.authorizationId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
