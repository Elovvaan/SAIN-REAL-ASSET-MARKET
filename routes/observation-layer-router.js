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
      state: req.query.state,
      recognitionState: req.query.recognitionState
    });
    res.json({ observations, count: observations.length });
  });

  router.get('/summary', (_req, res) => {
    res.json(observationLayerService.summary());
  });

  router.get('/recognitions', (req, res) => {
    const recognitions = observationLayerService.listRecognitions({
      observationId: req.query.observationId,
      state: req.query.state,
      classification: req.query.classification
    });
    res.json({ recognitions, count: recognitions.length });
  });

  router.get('/recognitions/:recognitionId', (req, res) => {
    const recognition = observationLayerService.getRecognition(req.params.recognitionId);
    if (!recognition) return res.status(404).json({ error: 'Recognition assessment not found.' });
    return res.json({ recognition });
  });

  router.get('/:observationId', (req, res) => {
    const observation = observationLayerService.get(req.params.observationId);
    if (!observation) return res.status(404).json({ error: 'Observation not found.' });
    const recognitions = observationLayerService.listRecognitions({ observationId: req.params.observationId });
    return res.json({ observation, recognitions });
  });

  router.post('/:observationId/recognize', async (req, res) => {
    try {
      const result = await observationLayerService.recognize(
        req.params.observationId,
        req.body || {},
        req.headers['x-sra-actor-id'] || 'SAIN_AGENT'
      );
      return res.status(201).json(result);
    } catch (error) {
      return errorResponse(res, error);
    }
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
