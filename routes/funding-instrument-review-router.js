import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = error.code === 'DRAFT_REVIEW_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_INSTRUMENT_REVIEW_ERROR',
    summary: error.summary || null,
  });
}

export function createFundingInstrumentReviewRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/instruments/:instrumentId/completeness', (req, res) => {
    try { return res.json(service.assessCompleteness(req.params.instrumentId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/reviews', (req, res) => {
    res.json({ records: service.listReviews({ instrumentId: req.query.instrumentId, status: req.query.status }) });
  });

  router.get('/reviews/:reviewId', (req, res) => {
    const record = service.getReview(req.params.reviewId);
    if (!record) return res.status(404).json({ error: 'Draft review was not found.' });
    return res.json(record);
  });

  router.post('/instruments/:instrumentId/reviews', async (req, res) => {
    try { return res.status(201).json(await service.startReview(req.params.instrumentId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/reviews/:reviewId/findings', (req, res) => {
    try {
      const review = service.getReview(req.params.reviewId);
      if (!review) return res.status(404).json({ error: 'Draft review was not found.' });
      return res.json({ records: service.listFindings(req.params.reviewId) });
    } catch (error) { return handle(res, error); }
  });

  router.post('/reviews/:reviewId/findings', async (req, res) => {
    try { return res.status(201).json(await service.recordFinding(req.params.reviewId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/reviews/:reviewId/summary', (req, res) => {
    try { return res.json(service.summarize(req.params.reviewId)); }
    catch (error) { return handle(res, error); }
  });

  router.post('/reviews/:reviewId/decision', async (req, res) => {
    try { return res.json(await service.decide(req.params.reviewId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/issuance-requests', (req, res) => {
    res.json({ records: service.listIssuanceRequests({ instrumentId: req.query.instrumentId, status: req.query.status }) });
  });

  router.post('/reviews/:reviewId/issuance-request', async (req, res) => {
    try { return res.status(201).json(await service.createIssuanceRequest(req.params.reviewId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
