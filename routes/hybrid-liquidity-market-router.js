import { Router } from 'express';

export function createHybridLiquidityMarketRouter(service) {
  const router = Router();

  router.get('/status', (_req, res) => res.json(service.status()));
  router.get('/markets', (_req, res) => res.json({ markets: service.list(), status: service.status() }));
  router.get('/markets/:marketId', (req, res) => {
    const market = service.get(req.params.marketId);
    return market ? res.json(market) : res.status(404).json({ error: 'Hybrid market definition was not found.' });
  });
  router.post('/preview', (req, res) => {
    try { return res.json(service.preview(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_PREVIEW_FAILED' }); }
  });
  router.post('/approve', async (req, res) => {
    try {
      const actorId = req.sraIdentity?.actorId || req.body?.actorId || 'SRA_PLATFORM_ADMIN';
      return res.status(201).json(await service.approveDefinition(req.body || {}, actorId));
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_APPROVAL_FAILED' }); }
  });
  router.post('/references', async (req, res) => {
    try { return res.status(201).json(await service.recordReference(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_REFERENCE_FAILED' }); }
  });

  return router;
}
