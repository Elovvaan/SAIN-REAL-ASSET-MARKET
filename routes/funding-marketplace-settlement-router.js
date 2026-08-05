import express from 'express';
import crypto from 'node:crypto';

const CONFIRMATION_TYPE = 'FUNDING_MARKETPLACE_SETTLEMENT_CONFIRMATION';

function actorId(req) {
  return req.sraOperationsAuth?.actorId || req.sraIdentity?.actorId || null;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function requireConnector(req, res) {
  const configured = process.env.SRA_SETTLEMENT_CONNECTOR_KEY || '';
  const supplied = req.get('x-sra-settlement-connector-key') || '';
  if (!configured) {
    res.status(503).json({ error: 'Settlement connector authentication is not configured.', code: 'SRA_SETTLEMENT_CONNECTOR_NOT_CONFIGURED' });
    return false;
  }
  if (!safeEqual(configured, supplied)) {
    res.status(401).json({ error: 'Settlement connector authentication failed.', code: 'SRA_SETTLEMENT_CONNECTOR_AUTHENTICATION_FAILED' });
    return false;
  }
  return true;
}

function handle(res, error) {
  const validationCodes = new Set(['SETTLEMENT_REVIEW_INCOMPLETE', 'SETTLEMENT_CONFIRMATION_MISMATCH', 'VERIFIED_SETTLEMENT_CONFIRMATION_REQUIRED']);
  const status = validationCodes.has(error.code) ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'FUNDING_MARKETPLACE_SETTLEMENT_ERROR', assessment: error.assessment || null });
}

function installConfirmationIdentityGuard(service) {
  const domain = service?.domain;
  if (!domain || domain.__settlementConfirmationIdentityGuard) return;
  const atomicPut = domain.atomicPut.bind(domain);
  domain.atomicPut = (changes = []) => atomicPut(changes.map((change) => {
    if (change?.type !== CONFIRMATION_TYPE || !change?.id) return change;
    return { ...change, payload: { id: change.id, ...(change.payload || {}) } };
  }));
  domain.__settlementConfirmationIdentityGuard = true;
}

export function createFundingMarketplaceSettlementRouter(service) {
  installConfirmationIdentityGuard(service);
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));
  router.get('/preparations/:preparationId/assessment', (req, res) => { try { return res.json(service.assessPreparation(req.params.preparationId)); } catch (error) { return handle(res, error); } });
  router.get('/reviews', (req, res) => res.json({ records: service.listReviews({ preparationId: req.query.preparationId, status: req.query.status }) }));
  router.get('/reviews/:reviewId', (req, res) => { const record = service.getReview(req.params.reviewId); return record ? res.json(record) : res.status(404).json({ error: 'Settlement review was not found.' }); });
  router.post('/preparations/:preparationId/reviews', async (req, res) => { try { return res.status(201).json(await service.startReview(req.params.preparationId, req.body, actorId(req))); } catch (error) { return handle(res, error); } });
  router.post('/reviews/:reviewId/decision', async (req, res) => { try { return res.json(await service.decide(req.params.reviewId, req.body, actorId(req))); } catch (error) { return handle(res, error); } });
  router.get('/authorizations', (req, res) => res.json({ records: service.listAuthorizations({ positionId: req.query.positionId, status: req.query.status }) }));

  router.get('/confirmations', (req, res) => res.json({ records: service.listConfirmations({ authorizationId: req.query.authorizationId, positionId: req.query.positionId, status: req.query.status, sourceType: req.query.sourceType }) }));
  router.get('/confirmations/:confirmationId', (req, res) => { const record = service.getConfirmation(req.params.confirmationId); return record ? res.json(record) : res.status(404).json({ error: 'Settlement confirmation was not found.' }); });

  router.post('/authorizations/:authorizationId/confirmations/internal-ledger', async (req, res) => {
    try { return res.status(201).json(await service.registerConfirmation(req.params.authorizationId, { ...req.body, sourceType: 'INTERNAL_LEDGER' }, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/confirmations/external', async (req, res) => {
    if (!requireConnector(req, res)) return;
    try {
      if (!req.body?.settlementAuthorizationId) return res.status(400).json({ error: 'settlementAuthorizationId is required.' });
      return res.status(201).json(await service.registerConfirmation(req.body.settlementAuthorizationId, { ...req.body, sourceType: 'EXTERNAL_RAIL' }, `CONNECTOR:${req.body.providerId || 'SETTLEMENT_RAIL'}`));
    } catch (error) { return handle(res, error); }
  });

  router.post('/confirmations/:confirmationId/verify', async (req, res) => {
    try { return res.json(await service.verifyConfirmation(req.params.confirmationId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/confirmations/:confirmationId/reversal', async (req, res) => {
    try { return res.json(await service.recordReversal(req.params.confirmationId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/authorizations/:authorizationId/settle', async (req, res) => {
    try { return res.status(201).json(await service.settle(req.params.authorizationId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
