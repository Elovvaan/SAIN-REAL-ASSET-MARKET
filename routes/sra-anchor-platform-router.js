import express from 'express';

function fail(res, error) {
  return res.status(error?.statusCode || 400).json({ error: error?.message || 'SRA Anchor Platform request failed.' });
}

export function createSraAnchorPlatformRouter(service) {
  const router = express.Router();
  router.get('/status', (_req, res) => { try { return res.json(service.status()); } catch (error) { return fail(res, error); } });
  router.get('/events', (req, res) => {
    try { service.authorizeCallback(req.get('X-Api-Key')); return res.json({ records: service.listEvents() }); }
    catch (error) { return fail(res, error); }
  });
  router.post('/events', async (req, res) => {
    try {
      service.authorizeCallback(req.get('X-Api-Key'));
      return res.status(202).json(await service.recordEvent(req.body || {}));
    } catch (error) { return fail(res, error); }
  });
  return router;
}
