import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected EDX extraction error.';
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

export function createEdxExtractionRouter(service) {
  const router = express.Router();

  router.get('/extraction-requests', (req, res) => {
    const requests = service.listRequests({
      enterpriseId: req.query.enterpriseId || null,
      connectionId: req.query.connectionId || null,
      policyId: req.query.policyId || null,
      state: req.query.state || null
    });
    return res.json({ extractionRequests: requests });
  });

  router.get('/extraction-requests/:extractionRequestId', (req, res) => {
    const record = service.getRequest(req.params.extractionRequestId);
    if (!record) return res.status(404).json({ error: 'Extraction request not found.' });
    return res.json(record);
  });

  router.post('/extraction-requests', async (req, res) => {
    try {
      const record = await service.createRequest(req.body || {}, actorId(req));
      return res.status(201).json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/extraction-requests/:extractionRequestId/transition', async (req, res) => {
    try {
      const record = await service.transitionRequest(
        req.params.extractionRequestId,
        req.body?.state,
        req.body || {},
        actorId(req)
      );
      return res.json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/extraction-requests/:extractionRequestId/execute', async (req, res) => {
    try {
      const result = await service.executeRequest(
        req.params.extractionRequestId,
        req.body || {},
        actorId(req)
      );
      return res.json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/extraction-results', (req, res) => {
    const results = service.listResults({
      enterpriseId: req.query.enterpriseId || null,
      connectionId: req.query.connectionId || null,
      policyId: req.query.policyId || null,
      extractionRequestId: req.query.extractionRequestId || null
    });
    return res.json({ extractionResults: results });
  });

  router.get('/extraction-results/:extractionResultId', (req, res) => {
    const record = service.getResult(req.params.extractionResultId);
    if (!record) return res.status(404).json({ error: 'Extraction result not found.' });
    return res.json(record);
  });

  return router;
}
