import { Router } from 'express';

export function createPublicSraCoinDiscoveryRouter(service) {
  const router = Router();
  router.get('/sra', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.set('Access-Control-Allow-Origin', '*');
    return res.json(service.profile());
  });
  return router;
}
