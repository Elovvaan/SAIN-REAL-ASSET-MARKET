import { Router } from 'express';

export function createSraBtcTreasuryRouteRouter(service) {
  const router = Router();
  router.use((req, res, next) => {
    const roles = req.sraOperationsAuth?.roles || [];
    if (!roles.some((role) => ['PLATFORM_ADMIN', 'OPERATIONS_ADMIN'].includes(role))) return res.status(403).json({ error:'Treasury admin session required.' });
    res.set('Cache-Control', 'no-store');
    return next();
  });
  const fail = (res, error) => res.status(422).json({ error:error.message });
  router.get('/status', (_req, res) => res.json(service.status()));
  router.post('/wallets', async (req, res) => {
    try { return res.status(201).json(await service.registerWallet(req.body || {}, req.sraOperationsAuth.actorId)); }
    catch (error) { return fail(res, error); }
  });
  router.post('/wallets/:walletId/validate', async (req, res) => {
    try { return res.json(await service.validateWallet(req.params.walletId, req.sraOperationsAuth.actorId)); }
    catch (error) { return fail(res, error); }
  });
  router.post('/wallets/:walletId/retire', async (req, res) => {
    try { return res.json(await service.retireWallet(req.params.walletId, req.sraOperationsAuth.actorId)); }
    catch (error) { return fail(res, error); }
  });
  router.post('/trades', async (req, res) => {
    try { return res.status(201).json(await service.prepareTrade(req.body || {}, req.sraOperationsAuth.actorId)); }
    catch (error) { return fail(res, error); }
  });
  router.post('/trades/:tradeId/verify-btc', async (req, res) => {
    try { return res.json(await service.verifyBtcReceipt(req.params.tradeId, req.body?.transactionId, req.sraOperationsAuth.actorId)); }
    catch (error) { return fail(res, error); }
  });
  return router;
}
