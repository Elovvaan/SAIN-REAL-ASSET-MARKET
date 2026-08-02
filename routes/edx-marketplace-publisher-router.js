import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected EDX marketplace publisher error.';
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

export function createEdxMarketplacePublisherRouter(service) {
  const router = express.Router();

  router.get('/publication-decisions', (req, res) => {
    const decisions = service.listDecisions({
      enterpriseId: req.query.enterpriseId || null,
      valuePackageId: req.query.valuePackageId || null,
      state: req.query.state || null,
      decision: req.query.decision || null
    });
    return res.json({ publicationDecisions: decisions });
  });

  router.get('/publication-decisions/:publicationDecisionId', (req, res) => {
    const record = service.getDecision(req.params.publicationDecisionId);
    if (!record) return res.status(404).json({ error: 'Publication decision not found.' });
    return res.json(record);
  });

  router.post('/publication-decisions', async (req, res) => {
    try {
      const record = await service.createDecision(req.body || {}, actorId(req));
      return res.status(201).json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/publication-decisions/:publicationDecisionId/approve', async (req, res) => {
    try {
      return res.json(await service.approveDecision(req.params.publicationDecisionId, req.body || {}, actorId(req)));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/publication-decisions/:publicationDecisionId/execute', async (req, res) => {
    try {
      return res.json(await service.executeDecision(req.params.publicationDecisionId, actorId(req)));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/publication-decisions/:publicationDecisionId/decline', async (req, res) => {
    try {
      return res.json(await service.declineDecision(req.params.publicationDecisionId, req.body || {}, actorId(req)));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/marketplace-projections', (req, res) => {
    const projections = service.listProjections({
      enterpriseId: req.query.enterpriseId || null,
      valuePackageId: req.query.valuePackageId || null,
      state: req.query.state || null
    });
    return res.json({ marketplaceProjections: projections });
  });

  router.get('/marketplace-projections/:projectionId', (req, res) => {
    const record = service.getProjection(req.params.projectionId);
    if (!record) return res.status(404).json({ error: 'Marketplace projection not found.' });
    return res.json(record);
  });

  router.post('/marketplace-projections/:projectionId/withdraw', async (req, res) => {
    try {
      return res.json(await service.withdrawProjection(req.params.projectionId, req.body || {}, actorId(req)));
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
