import { AgentWorkforceService } from '../services/agent-workforce-service.js';

export async function installAgentWorkforceAdminRoutes({ router, domain, database, requireAdmin }) {
  const workforce = new AgentWorkforceService({ domain, database });
  await workforce.initialize();

  router.get('/api/admin/agent-workforce/status', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(workforce.status());
  });

  router.get('/api/admin/agent-workforce/agents', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({ records: workforce.listAgents({ state: req.query.state, role: req.query.role }) });
  });

  router.post('/api/admin/agent-workforce/agents', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.status(201).json(await workforce.registerAgent(req.body || {}, session)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_REGISTRATION_FAILED' }); }
  });

  router.get('/api/admin/agent-workforce/work', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({ records: workforce.listWork({ agentId: req.query.agentId, state: req.query.state, opportunityId: req.query.opportunityId }) });
  });

  router.post('/api/admin/agent-workforce/work', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.status(201).json(await workforce.assignWork(req.body || {}, session)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_WORK_ASSIGNMENT_FAILED' }); }
  });

  router.post('/api/admin/agent-workforce/work/:workOrderId/start', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await workforce.startWork(req.params.workOrderId, session)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_WORK_START_FAILED' }); }
  });

  router.post('/api/admin/agent-workforce/work/:workOrderId/complete', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await workforce.completeWork(req.params.workOrderId, req.body || {}, session)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_WORK_COMPLETION_FAILED' }); }
  });

  router.post('/api/admin/agent-workforce/work/:workOrderId/accept', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await workforce.acceptWork(req.params.workOrderId, req.body || {}, session)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_WORK_ACCEPTANCE_FAILED' }); }
  });

  router.get('/api/admin/agent-workforce/compensation', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({ records: workforce.listCompensation({ agentId: req.query.agentId, state: req.query.state }) });
  });

  router.post('/api/admin/agent-workforce/compensation/:compensationId/authorize', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await workforce.transitionCompensation(req.params.compensationId, 'AUTHORIZED', req.body || {}, session)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_COMPENSATION_AUTHORIZATION_FAILED' }); }
  });

  router.post('/api/admin/agent-workforce/compensation/:compensationId/paid', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await workforce.transitionCompensation(req.params.compensationId, 'PAID', req.body || {}, session)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_COMPENSATION_PAYMENT_FAILED' }); }
  });

  return workforce;
}
