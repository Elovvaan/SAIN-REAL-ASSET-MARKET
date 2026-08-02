import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || null;
}

function handle(res, error, fallbackStatus = 400) {
  const status = /not found/i.test(error.message) ? 404 : fallbackStatus;
  return res.status(status).json({ error: error.message });
}

export function createInstrumentRouter(instrumentService) {
  const router = express.Router();

  router.get('/families', (_req, res) => {
    res.json({ families: instrumentService.listFamilies() });
  });

  router.get('/families/:familyId', (req, res) => {
    const family = instrumentService.getFamily(req.params.familyId);
    if (!family) return res.status(404).json({ error: 'Instrument family not found.' });
    return res.json({ family });
  });

  router.post('/families', async (req, res) => {
    try {
      const family = await instrumentService.createFamily(req.body, actorId(req));
      return res.status(201).json({ family });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/series', (req, res) => {
    const series = instrumentService.listSeries({
      assetId: req.query.assetId,
      projectId: req.query.projectId,
      familyId: req.query.familyId,
      state: req.query.state
    });
    res.json({ series });
  });

  router.post('/series', async (req, res) => {
    try {
      const series = await instrumentService.createSeries(req.body, actorId(req));
      return res.status(201).json({ series });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/series/:seriesId', (req, res) => {
    try {
      return res.json(instrumentService.getSeriesWorkspace(req.params.seriesId));
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/series/:seriesId/transitions', async (req, res) => {
    try {
      const series = await instrumentService.transitionSeries(
        req.params.seriesId,
        req.body.targetState,
        actorId(req),
        req.body.payload || {}
      );
      return res.json({ series });
    } catch (error) {
      return handle(res, error);
    }
  });

  return router;
}
