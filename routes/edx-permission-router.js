import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected EDX permission error.';
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

export function createEdxPermissionRouter(service) {
  const router = express.Router();

  router.get('/policies', (req, res) => {
    const policies = service.listPolicies({
      enterpriseId: req.query.enterpriseId || null,
      connectionId: req.query.connectionId || null,
      state: req.query.state || null,
      visibility: req.query.visibility || null
    });
    return res.json({ policies });
  });

  router.get('/policies/:policyId', (req, res) => {
    const policy = service.getPolicy(req.params.policyId);
    if (!policy) return res.status(404).json({ error: 'Extraction policy not found.' });
    return res.json(policy);
  });

  router.post('/policies', async (req, res) => {
    try {
      const policy = await service.createPolicy(req.body || {}, actorId(req));
      return res.status(201).json(policy);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.put('/policies/:policyId', async (req, res) => {
    try {
      const policy = await service.updatePolicy(req.params.policyId, req.body || {}, actorId(req));
      return res.json(policy);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/policies/:policyId/transition', async (req, res) => {
    try {
      const policy = await service.transitionPolicy(
        req.params.policyId,
        req.body?.state,
        req.body || {},
        actorId(req)
      );
      return res.json(policy);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/policies/:policyId/evaluate', (req, res) => {
    try {
      return res.json(service.evaluatePolicy(req.params.policyId, req.body || {}));
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
