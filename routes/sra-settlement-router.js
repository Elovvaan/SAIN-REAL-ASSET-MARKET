import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected SRA settlement error.';
  return res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

export function createSraSettlementRouter(service) {
  const router = express.Router();

  router.get('/settlements', (req, res) => {
    return res.json({ settlements: service.listSettlements({
      homeProjectId: req.query.homeProjectId || null,
      customerId: req.query.customerId || null,
      state: req.query.state || null
    }) });
  });

  router.get('/settlements/readiness/:homeProjectId', (req, res) => {
    try { return res.json(service.readiness(req.params.homeProjectId)); }
    catch (error) { return handleError(res, error); }
  });

  router.post('/settlements/prepare', async (req, res) => {
    try { return res.status(201).json(await service.prepare(req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/settlements/:settlementId', (req, res) => {
    const record = service.getSettlement(req.params.settlementId);
    return record ? res.json(record) : res.status(404).json({ error: 'SRA Settlement not found.' });
  });

  router.get('/settlements/:settlementId/events', (req, res) => {
    try { return res.json({ events: service.events(req.params.settlementId) }); }
    catch (error) { return handleError(res, error); }
  });

  router.post('/settlements/:settlementId/lock', async (req, res) => {
    try { return res.json(await service.lock(req.params.settlementId, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.post('/settlements/:settlementId/execute', async (req, res) => {
    try { return res.json(await service.execute(req.params.settlementId, req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.post('/settlements/:settlementId/cancel', async (req, res) => {
    try { return res.json(await service.cancel(req.params.settlementId, req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/settlement-records', (req, res) => {
    return res.json({ settlementRecords: service.listRecords({
      homeProjectId: req.query.homeProjectId || null,
      assetId: req.query.assetId || null
    }) });
  });

  router.get('/settlement-records/:settlementRecordId', (req, res) => {
    const record = service.getRecord(req.params.settlementRecordId);
    return record ? res.json(record) : res.status(404).json({ error: 'Settlement Record not found.' });
  });

  return router;
}
