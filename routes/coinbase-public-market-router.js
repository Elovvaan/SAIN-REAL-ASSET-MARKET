import { Router } from 'express';

export function createCoinbasePublicMarketRouter(service) {
  const router = Router();
  router.get('/api/connectors/coinbase-public/status', (_req, res) => res.json(service.status()));
  return router;
}
