import { AgentWorkforceService } from '../services/agent-workforce-service.js';
import { AgentServiceFeeService } from '../services/agent-service-fee-service.js';
import { AgentServiceFeeBillingService } from '../services/agent-service-fee-billing-service.js';
import { SraAgentOperatingSystemService } from '../services/sra-agent-operating-system-service.js';
import { UnifiedMarketOperationsQueueService } from '../services/unified-market-operations-queue-service.js';
import { CounterpartyOperationsStatusService } from '../services/counterparty-operations-status-service.js';
import { AutonomousOperationalContinuationService } from '../services/autonomous-operational-continuation-service.js';

export async function installAgentWorkforceAdminRoutes({ router, domain, database, requireAdmin }) {
  const workforce = new AgentWorkforceService({ domain, database });
  const serviceFees = new AgentServiceFeeService();
  const serviceFeeBilling = new AgentServiceFeeBillingService(domain);
  const operationsQueue = new UnifiedMarketOperationsQueueService(domain);
  const agentOS = new SraAgentOperatingSystemService(domain, { operationsQueue });
  const counterpartyOperations = new CounterpartyOperationsStatusService(domain);
  const autonomousContinuation = new AutonomousOperationalContinuationService(domain);
  await workforce.initialize();
  await serviceFeeBilling.initialize('SRA_AGENT_OS');

  const synchronizedAgents = await workforce.synchronizeOperatingAgents(agentOS.registry(), { id: 'SRA_AGENT_OS' });
  const initialQueue = await operationsQueue.explainPersisted();
  const initialRun = await workforce.runOperationalQueue(initialQueue, { id: 'SRA_AGENT_OS' });

  const queueRates = (queue) => [...(queue.queue || []), ...(queue.exceptions || [])].map(entry => ({
    sourceRecordId: entry.id,
    stage: entry.stage,
    state: entry.state,
    requestedAction: entry.nextAction || null,
    participantId: entry.participantId || null,
    instrumentId: entry.instrumentId || null,
    listingId: entry.listingId || null,
    positionId: entry.positionId || null,
    serviceFee: serviceFees.quoteWorkflowStage(entry.stage),
  }));

  router.get('/api/admin/counterparty-operations', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json({ phase: 5, operations: await counterpartyOperations.listActive() }); }
    catch (error) { return res.status(500).json({ error: error?.message || String(error), code: 'SRA_COUNTERPARTY_OPERATIONS_STATUS_FAILED' }); }
  });

  router.get('/api/admin/counterparty-operations/:exportPackageId', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await counterpartyOperations.forExportPackage(req.params.exportPackageId)); }
    catch (error) { return res.status(400).json({ error: error?.message || String(error), code: 'SRA_COUNTERPARTY_OPERATION_STATUS_FAILED' }); }
  });

  router.get('/api/admin/autonomous-continuation', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const records = domain.list('EXPORT_PACKAGE').filter((pkg) => String(pkg.exportKind || '').toUpperCase() === 'FINANCING_DISBURSEMENT').map((pkg) => ({ exportPackageId: pkg.exportPackageId, ...autonomousContinuation.summary(pkg.exportPackageId) }));
      return res.json({ phase: 6, records });
    } catch (error) { return res.status(500).json({ error: error?.message || String(error), code: 'SRA_AUTONOMOUS_CONTINUATION_STATUS_FAILED' }); }
  });

  router.get('/api/admin/autonomous-continuation/:exportPackageId', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json({ evaluation: await autonomousContinuation.evaluate(req.params.exportPackageId), persisted: autonomousContinuation.summary(req.params.exportPackageId) }); }
    catch (error) { return res.status(400).json({ error: error?.message || String(error), code: 'SRA_AUTONOMOUS_CONTINUATION_EVALUATION_FAILED' }); }
  });

  router.post('/api/admin/autonomous-continuation/:exportPackageId/run', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await autonomousContinuation.execute(req.params.exportPackageId, { agentId: 'SRA-CONTINUATION-AGENT' })); }
    catch (error) { return res.status(422).json({ error: error?.message || String(error), code: 'SRA_AUTONOMOUS_CONTINUATION_FAILED' }); }
  });

  router.post('/api/admin/autonomous-continuation/run', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await autonomousContinuation.runAll()); }
    catch (error) { return res.status(422).json({ error: error?.message || String(error), code: 'SRA_AUTONOMOUS_CONTINUATION_BATCH_FAILED' }); }
  });

  router.get('/api/admin/agent-workforce/status', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const queue = await operationsQueue.explainPersisted();
    return res.json({
      workforce: workforce.status(),
      agentOS: agentOS.brief(),
      platinumPhase6: { service: 'AUTONOMOUS_OPERATIONAL_CONTINUATION', records: domain.list('AUTONOMOUS_CONTINUATION').length, followUps: domain.list('AUTONOMOUS_CONTINUATION_FOLLOW_UP').filter((record) => record.status === 'OPEN').length },
      synchronizedAgents: { createdCount: synchronizedAgents.created.length, existingCount: synchronizedAgents.existing.length, agentCount: synchronizedAgents.agentCount },
      initialRun: { createdCount: initialRun.createdCount, completedCount: initialRun.completedCount, skippedCount: initialRun.skippedCount },
      serviceFeeSchedule: serviceFees.policy(),
      serviceFeeBilling: serviceFeeBilling.status(),
      workflowServiceRates: serviceFees.workflowRates(),
      currentQueueServiceRates: queueRates(queue),
    });
  });

  router.get('/api/admin/agent-workforce/service-rates', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const queue = await operationsQueue.explainPersisted();
    return res.json({
      schedule: serviceFees.policy(),
      billing: serviceFeeBilling.status(),
      workflowRates: serviceFees.workflowRates(),
      currentQueue: {
        state: queue.state,
        totalAwaitingAction: queue.totalAwaitingAction,
        totalExceptions: queue.totalExceptions,
        records: queueRates(queue),
      },
    });
  });

  router.get('/api/admin/agent-workforce/service-fees', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({
      status: serviceFeeBilling.status(),
      records: serviceFeeBilling.listCharges({ payerId: req.query.payerId, subjectId: req.query.subjectId, state: req.query.state }),
    });
  });

  router.post('/api/admin/agent-workforce/service-fees/:chargeId/servicing', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await serviceFeeBilling.attachChargeToServicing(req.params.chargeId, req.body || {}, session.id)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_AGENT_SERVICE_FEE_SERVICING_FAILED' }); }
  });

  router.post('/api/admin/agent-workforce/run', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const synchronized = await workforce.synchronizeOperatingAgents(agentOS.registry(), session);
      const queue = await operationsQueue.explainPersisted();
      const run = await workforce.runOperationalQueue(queue, { id: 'SRA_AGENT_OS' });
      const continuation = await autonomousContinuation.runAll();
      return res.json({
        agentOS: agentOS.brief(),
        synchronizedAgents: { createdCount: synchronized.created.length, existingCount: synchronized.existing.length, agentCount: synchronized.agentCount },
        queue: { state: queue.state, totalAwaitingAction: queue.totalAwaitingAction, totalExceptions: queue.totalExceptions, nextRecommendedAction: queue.nextRecommendedAction },
        serviceRates: queueRates(queue),
        run,
        continuation,
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
    return res.json({ records: workforce.listWork({ agentId: req.query.agentId, state: req.query.state, opportunityId: req.query.opportunityId }).map(work => ({ ...work, serviceFee: serviceFees.quoteWorkOrder(work), serviceFeeCharge: serviceFeeBilling.existingChargeForWork(work.workOrderId) })) });
  });

  router.post('/api/admin/agent-workforce/work', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const work = await workforce.assignWork(req.body || {}, session);
      return res.status(201).json({ ...work, serviceFee: serviceFees.quoteWorkOrder(work) });
    }
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
    const current = workforce.getWork(req.params.workOrderId);
    if (!current) return res.status(404).json({ error: 'Agent work order not found.', code: 'SRA_AGENT_WORK_NOT_FOUND' });
    const payerId = String(req.body?.payerId || current.serviceFeePayerId || '').trim() || null;
    try {
      serviceFeeBilling.validateServicingTarget({
        payerId,
        servicingAccountId: req.body?.servicingAccountId,
        dueDate: req.body?.dueDate,
      });
    } catch (error) {
      return res.status(422).json({ error: error.message, code: 'SRA_AGENT_SERVICE_FEE_SERVICING_VALIDATION_FAILED' });
    }

    let accepted;
    try {
      accepted = await workforce.acceptWork(req.params.workOrderId, req.body || {}, session);
    } catch (error) {
      return res.status(422).json({ error: error.message, code: 'SRA_AGENT_WORK_ACCEPTANCE_FAILED' });
    }

    let feeAssessment;
    try {
      feeAssessment = await serviceFeeBilling.assessAcceptedWork(accepted.work, {
        payerId: req.body?.payerId,
        payerType: req.body?.payerType,
      }, session.id);
    } catch (error) {
      return res.json({
        ...accepted,
        serviceFee: serviceFees.quoteWorkOrder(accepted.work),
        serviceFeeAssessment: { assessed: false, error: error.message, code: 'SRA_AGENT_SERVICE_FEE_ASSESSMENT_FAILED' },
        servicing: null,
      });
    }

    let servicing = null;
    if (feeAssessment.charge && req.body?.servicingAccountId && req.body?.dueDate) {
      try {
        servicing = await serviceFeeBilling.attachChargeToServicing(feeAssessment.charge.chargeId, {
          servicingAccountId: req.body.servicingAccountId,
          dueDate: req.body.dueDate,
          recurrence: req.body.recurrence || null,
        }, session.id);
      } catch (error) {
        servicing = { attached: false, error: error.message, code: 'SRA_AGENT_SERVICE_FEE_SERVICING_FAILED' };
      }
    }
    return res.json({ ...accepted, serviceFee: serviceFees.quoteWorkOrder(accepted.work), serviceFeeAssessment: feeAssessment, servicing });
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
