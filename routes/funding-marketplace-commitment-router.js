import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = ['COMMITMENT_WINDOW_INCOMPLETE', 'COMMITMENT_INELIGIBLE'].includes(error.code) ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_MARKETPLACE_COMMITMENT_ERROR',
    assessment: error.assessment || null,
  });
}

export function createFundingMarketplaceCommitmentRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/listings/:listingId/assessment', (req, res) => {
    try { return res.json(service.assessListing(req.params.listingId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/windows', (req, res) => {
    res.json({ records: service.listWindows({ listingId: req.query.listingId, status: req.query.status }) });
  });

  router.post('/listings/:listingId/windows', async (req, res) => {
    try { return res.status(201).json(await service.openWindow(req.params.listingId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/windows/:windowId/participants/:participantId/assessment', (req, res) => {
    try { return res.json(service.assessParticipant(req.params.windowId, req.params.participantId, req.query.quantity)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/commitments', (req, res) => {
    res.json({ records: service.listCommitments({ listingId: req.query.listingId, participantId: req.query.participantId, status: req.query.status }) });
  });

  router.post('/windows/:windowId/commitments', async (req, res) => {
    try { return res.status(201).json(await service.createCommitment(req.params.windowId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/commitments/:commitmentId/confirm', async (req, res) => {
    try { return res.json(await service.confirmCommitment(req.params.commitmentId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/commitments/:commitmentId/cancel', async (req, res) => {
    try { return res.json(await service.cancelCommitment(req.params.commitmentId, req.body?.reason || null, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
