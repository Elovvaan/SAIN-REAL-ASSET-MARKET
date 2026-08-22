import {
  SRA_AGENT_SERVICE_FEE_SCHEDULE,
  getSraAgentServiceFee,
  getSraWorkflowServiceFee,
} from '../config/agent-service-fee-schedule.js';

export class AgentServiceFeeService {
  policy() { return SRA_AGENT_SERVICE_FEE_SCHEDULE; }

  quoteAgent(agentId) {
    const service = getSraAgentServiceFee(agentId);
    if (!service) return null;
    return { ...service };
  }

  quoteWorkflowStage(stage) {
    const service = getSraWorkflowServiceFee(stage);
    if (!service) return null;
    return {
      stage: String(stage || '').trim().toUpperCase(),
      ...service,
    };
  }

  quoteWorkOrder(workOrder={}) {
    // Once a worker is assigned, that worker is authoritative. If the assigned
    // worker does not have a configured SRA service fee, do not borrow another
    // worker's stage rate. Stage mapping is only a pre-assignment lookup.
    const assignedAgentId = String(workOrder.agentId || '').trim();
    const quote = assignedAgentId
      ? this.quoteAgent(assignedAgentId)
      : this.quoteWorkflowStage(workOrder.sourceStage);
    if (!quote) return null;
    return {
      scheduleId: SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId,
      scheduleVersion: SRA_AGENT_SERVICE_FEE_SCHEDULE.version,
      basis: SRA_AGENT_SERVICE_FEE_SCHEDULE.basis,
      feeCode: quote.feeCode,
      serviceName: quote.serviceName,
      agentId: assignedAgentId || quote.agentId,
      workflowStage: workOrder.sourceStage || null,
      sourceRecordId: workOrder.sourceRecordId || null,
      requestedAction: workOrder.requestedAction || null,
      amount: quote.amount,
      currency: quote.currency,
      humanEquivalentRole: quote.humanEquivalentRole,
      humanEquivalentMinutes: quote.humanEquivalentMinutes,
      effectiveDate: quote.effectiveDate,
    };
  }

  workflowRates() {
    return Object.values(SRA_AGENT_SERVICE_FEE_SCHEDULE.services).flatMap(service =>
      service.workflowStages.map(stage => ({
        stage,
        agentId: service.agentId,
        feeCode: service.feeCode,
        serviceName: service.serviceName,
        amount: service.amount,
        currency: service.currency,
        humanEquivalentRole: service.humanEquivalentRole,
        humanEquivalentMinutes: service.humanEquivalentMinutes,
        effectiveDate: service.effectiveDate,
      }))
    );
  }
}
