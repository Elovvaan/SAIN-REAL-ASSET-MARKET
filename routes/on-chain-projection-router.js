import express from 'express';
import { ExternalDexAdapterService } from '../services/external-dex-adapter-service.js';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = ['PROJECTION_INELIGIBLE','DEX_EXPORT_INELIGIBLE'].includes(error.code) ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'ON_CHAIN_PROJECTION_ERROR', assessment: error.assessment || null });
}

export function createOnChainProjectionRouter(service) {
  const router = express.Router();
  const dex = new ExternalDexAdapterService(service.domain, service);

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/eligibility/:instrumentId', (req, res) => {
    res.json(service.evaluateInstrument(req.params.instrumentId));
  });

  router.get('/projections', (req, res) => {
    res.json({ records: service.listProjections({ status: req.query.status, instrumentId: req.query.instrumentId, network: req.query.network }) });
  });

  router.get('/projections/:projectionId', (req, res) => {
    const record = service.getProjection(req.params.projectionId);
    if (!record) return res.status(404).json({ error: 'Projection not found.' });
    return res.json(record);
  });

  router.post('/projections', async (req, res) => {
    try { return res.status(201).json(await service.createProjection(req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/projections/:projectionId/approve', async (req, res) => {
    try { return res.json(await service.approveProjection(req.params.projectionId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/projections/:projectionId/mint', async (req, res) => {
    try { return res.status(201).json(await service.createMint(req.params.projectionId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/projections/:projectionId/allocate', async (req, res) => {
    try { return res.status(201).json(await service.allocate(req.params.projectionId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/wallets', (req, res) => {
    res.json({ records: service.listWallets({ participantId: req.query.participantId, status: req.query.status }) });
  });

  router.post('/wallets', async (req, res) => {
    try { return res.status(201).json(await service.registerWallet(req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/wallets/:walletId/approve', async (req, res) => {
    try { return res.json(await service.approveWallet(req.params.walletId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/events', (req, res) => res.json({ records: service.listChainEvents(req.query.projectionId || null) }));

  router.post('/events', async (req, res) => {
    try { return res.status(201).json(await service.recordChainEvent(req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/events/:eventId/reconcile', async (req, res) => {
    try { return res.json(await service.reconcileEvent(req.params.eventId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/reconciliations', (req, res) => res.json({ records: service.listReconciliations(req.query.projectionId || null) }));

  router.get('/dex/status', async (_req, res) => {
    try { return res.json(await dex.status()); }
    catch (error) { return handle(res, error); }
  });

  router.get('/dex/venues', (_req, res) => res.json({ records: dex.venues() }));

  router.get('/dex/exports', async (req, res) => {
    try { return res.json({ records: await dex.listExports({ state: req.query.state, venue: req.query.venue, exportPackageId: req.query.exportPackageId }) }); }
    catch (error) { return handle(res, error); }
  });

  router.get('/dex/exports/:dexExportId', async (req, res) => {
    try {
      const record = await dex.getExport(req.params.dexExportId);
      return record ? res.json(record) : res.status(404).json({ error: 'DEX export was not found.' });
    } catch (error) { return handle(res, error); }
  });

  router.post('/dex/exports/preview', (req, res) => {
    try { return res.json(dex.preview(req.body || {})); }
    catch (error) { return handle(res, error); }
  });

  router.post('/dex/exports', async (req, res) => {
    try { return res.status(201).json(await dex.prepare(req.body || {}, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/dex/exports/:dexExportId/submitted', async (req, res) => {
    try { return res.json(await dex.markSubmitted(req.params.dexExportId, req.body || {}, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/dex/exports/:dexExportId/confirm', async (req, res) => {
    try { return res.status(201).json(await dex.confirm(req.params.dexExportId, req.body || {}, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
