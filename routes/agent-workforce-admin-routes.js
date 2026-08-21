import { AgentWorkforceService } from '../services/agent-workforce-service.js';
import { SraAgentOperatingSystemService } from '../services/sra-agent-operating-system-service.js';
import { UnifiedMarketOperationsQueueService } from '../services/unified-market-operations-queue-service.js';

export async function installAgentWorkforceAdminRoutes({ router, domain, database, requireAdmin }) {
  const workforce = new AgentWorkforceService({ domain, database });
  const operationsQueue = new UnifiedMarketOperationsQueueService(domain);
  const agentOS = new SraAgentOperatingSystemService(domain, { operationsQueue });
  await workforce.initialize();

  const synchronizedAgents = await workforce.synchronizeOperatingAgents(agentOS.registry(), { id: 'SRA_AGENT_OS' });
  const initialQueue = operationsQueue.explain();
  const initialRun = await workforce.runOperationalQueue(initialQueue, { id: 'SRA_AGENT_OS' });

  router.get('/api/admin/agent-workforce/status', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({
      workforce: workforce.status(),
      agentOS: agentOS.brief(),
      synchronizedAgents: { createdCount: synchronizedAgents.created.length, existingCount: synchronizedAgents.existing.length, agentCount: synchronizedAgents.agentCount },
      initialRun: { createdCount: initialRun.createdCount, completedCount: initialRun.completedCount, skippedCount: initialRun.skippedCount },
    });
  });

  router.post('/api/admin/agent-workforce/run', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const synchronized = await workforce.synchronizeOperatingAgents(agentOS.registry(), session);
      const queue = operationsQueue.explain();
      const run = await workforce.runOperationalQueue(queue, { id: 'SRA_AGENT_OS' });
      return res.json({
        agentOS: agentOS.brief(),
        synchronizedAgents: { createdCount: synchronized.created.length, existingCount: synchronized.existing.length, agentCount: synchronized.agentCount },
        queue: { state: queue.state, totalAwaitingAction: queue.totalAwaitingAction, totalExceptions: queue.totalExceptions, nextRecommendedAction: queue.nextRecommendedAction },
        run,
      });
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_WORKFORCE_RUN_FAILED' }); }
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
