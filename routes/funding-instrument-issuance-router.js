import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = error.code === 'ISSUANCE_REVIEW_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_INSTRUMENT_ISSUANCE_ERROR',
    assessment: error.assessment || null,
  });
}

export function createFundingInstrumentIssuanceRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/requests/:requestId/assessment', (req, res) => {
    try { return res.json(service.assessRequest(req.params.requestId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/reviews', (req, res) => {
    res.json({ records: service.listReviews({ issuanceRequestId: req.query.issuanceRequestId, status: req.query.status }) });
  });

  router.get('/reviews/:reviewId', (req, res) => {
    const record = service.getReview(req.params.reviewId);
    if (!record) return res.status(404).json({ error: 'Issuance review was not found.' });
    return res.json(record);
  });

  router.post('/requests/:requestId/reviews', async (req, res) => {
    try { return res.status(201).json(await service.startReview(req.params.requestId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/reviews/:reviewId/decision', async (req, res) => {
    try { return res.json(await service.decide(req.params.reviewId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/authorizations', (req, res) => {
    res.json({ records: service.listAuthorizations({ instrumentId: req.query.instrumentId, status: req.query.status }) });
  });

  router.post('/authorizations/:authorizationId/issue', async (req, res) => {
    try { return res.status(201).json(await service.issue(req.params.authorizationId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
