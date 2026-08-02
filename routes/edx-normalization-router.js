import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected EDX normalization error.';
  return res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

export function createEdxNormalizationRouter(service) {
  const router = express.Router();

  router.get('/normalized-records', (req, res) => {
    const records = service.listRecords({
      enterpriseId: req.query.enterpriseId || null,
      category: req.query.category || null,
      extractionResultId: req.query.extractionResultId || null,
      verificationState: req.query.verificationState || null
    });
    return res.json({ normalizedRecords: records });
  });

  router.get('/normalized-records/:normalizedRecordId', (req, res) => {
    const record = service.getRecord(req.params.normalizedRecordId);
    if (!record) return res.status(404).json({ error: 'Normalized record not found.' });
    return res.json(record);
  });

  router.post('/extraction-results/:extractionResultId/normalize', async (req, res) => {
    try {
      const result = await service.normalizeExtractionResult(req.params.extractionResultId, req.body || {}, actorId(req));
      return res.status(201).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/normalized-records/:normalizedRecordId/verification', async (req, res) => {
    try {
      const record = await service.transitionVerification(
        req.params.normalizedRecordId,
        req.body?.verificationState,
        req.body || {},
        actorId(req)
      );
      return res.json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
