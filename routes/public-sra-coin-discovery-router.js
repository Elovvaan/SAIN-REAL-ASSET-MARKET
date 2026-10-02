import { Router } from 'express';

export function createPublicSraCoinDiscoveryRouter(service) {
  const router = Router();
  router.get('/sra', async (_req, res, next) => {
    try { await service.refreshLedgerAssets?.(); } catch (error) { return next(error); }
    res.set('Cache-Control', 'public, max-age=60');
    res.set('Access-Control-Allow-Origin', '*');
    return res.json(service.profile());
  });
  return router;
}
