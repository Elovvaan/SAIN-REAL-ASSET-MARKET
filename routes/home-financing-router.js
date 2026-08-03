import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected home financing error.';
  return res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

export function createHomeFinancingRouter(service) {
  const router = express.Router();

  router.get('/home-projects', (req, res) => {
    return res.json({ homeProjects: service.listProjects({
      customerId: req.query.customerId || null,
      enterpriseId: req.query.enterpriseId || null,
      state: req.query.state || null
    }) });
  });

  router.post('/home-projects', async (req, res) => {
    try { return res.status(201).json(await service.createProject(req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/home-projects/:homeProjectId', (req, res) => {
    const record = service.getProject(req.params.homeProjectId);
    return record ? res.json(record) : res.status(404).json({ error: 'Home Project not found.' });
  });

  router.put('/home-projects/:homeProjectId', async (req, res) => {
    try { return res.json(await service.updateProject(req.params.homeProjectId, req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.post('/home-projects/:homeProjectId/transition', async (req, res) => {
    try { return res.json(await service.transitionProject(req.params.homeProjectId, req.body?.state, req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/home-projects/:homeProjectId/workspace', (req, res) => {
    try { return res.json(service.workspace(req.params.homeProjectId)); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/funding-plans', (req, res) => {
    return res.json({ fundingPlans: service.listFundingPlans({
      homeProjectId: req.query.homeProjectId || null,
      customerId: req.query.customerId || null,
      state: req.query.state || null
    }) });
  });

  router.post('/funding-plans', async (req, res) => {
    try { return res.status(201).json(await service.createFundingPlan(req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/funding-plans/:fundingPlanId', (req, res) => {
    const record = service.getFundingPlan(req.params.fundingPlanId);
    return record ? res.json(record) : res.status(404).json({ error: 'Funding Plan not found.' });
  });

  router.post('/funding-plans/:fundingPlanId/transition', async (req, res) => {
    try { return res.json(await service.transitionFundingPlan(req.params.fundingPlanId, req.body?.state, req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  return router;
}
