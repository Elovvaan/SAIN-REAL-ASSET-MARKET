import { Router } from 'express';

export function createValueIntelligenceRouter(service) {
  const router = Router();

  router.get('/summary', (_req, res) => {
    res.json(service.summary());
  });

  router.get('/assets/:assetId', (req, res) => {
    try {
      res.json(service.listAssetState(req.params.assetId));
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });

  router.post('/signals', (req, res) => {
    try {
      res.status(201).json({ signal: service.createSignal(req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/events/verify', (req, res) => {
    try {
      res.status(201).json(service.verifyMarketEvent(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
