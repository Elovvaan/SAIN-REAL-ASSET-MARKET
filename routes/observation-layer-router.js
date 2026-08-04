import express from 'express';

function errorResponse(res, error) {
  return res.status(400).json({ error: error?.message || 'Observation request failed.' });
}

export function createObservationLayerRouter(observationLayerService) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const observations = observationLayerService.list({
      market: req.query.market,
      recordType: req.query.recordType,
      state: req.query.state
    });
    res.json({ observations, count: observations.length });
  });

  router.get('/summary', (_req, res) => {
    res.json(observationLayerService.summary());
  });

  router.get('/:observationId', (req, res) => {
    const observation = observationLayerService.get(req.params.observationId);
    if (!observation) return res.status(404).json({ error: 'Observation not found.' });
    return res.json({ observation });
  });

  router.post('/', async (req, res) => {
    try {
      const result = await observationLayerService.observe(req.body || {}, req.headers['x-sra-actor-id'] || 'SRA_PLATFORM');
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  return router;
}
