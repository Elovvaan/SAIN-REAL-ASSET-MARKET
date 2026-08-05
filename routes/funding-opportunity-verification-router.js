import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = error.code === 'VERIFICATION_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_VERIFICATION_ERROR',
    summary: error.summary || null,
  });
}

export function createFundingOpportunityVerificationRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/requests', (req, res) => {
    res.json({ records: service.listRequests({ opportunityId: req.query.opportunityId, status: req.query.status }) });
  });

  router.get('/requests/:requestId', (req, res) => {
    const record = service.getRequest(req.params.requestId);
    if (!record) return res.status(404).json({ error: 'Verification request was not found.' });
    return res.json(record);
  });

  router.post('/requests/:requestId/start', async (req, res) => {
    try { return res.json(await service.startReview(req.params.requestId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/requests/:requestId/findings', (req, res) => {
    try {
      const request = service.getRequest(req.params.requestId);
      if (!request) return res.status(404).json({ error: 'Verification request was not found.' });
      return res.json({ records: service.listFindings(req.params.requestId) });
    } catch (error) { return handle(res, error); }
  });

  router.post('/requests/:requestId/findings', async (req, res) => {
    try { return res.status(201).json(await service.recordFinding(req.params.requestId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/requests/:requestId/summary', (req, res) => {
    try { return res.json(service.summarize(req.params.requestId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/requests/:requestId/decision', (req, res) => {
    try {
      const request = service.getRequest(req.params.requestId);
      if (!request) return res.status(404).json({ error: 'Verification request was not found.' });
      return res.json(service.getDecision(req.params.requestId));
    } catch (error) { return handle(res, error); }
  });

  router.post('/requests/:requestId/decision', async (req, res) => {
    try { return res.status(201).json(await service.decide(req.params.requestId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
