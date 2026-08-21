import { SRA_AGENT_COMPENSATION_POLICY, getSraAgentCompensation } from '../config/agent-compensation-policy.js';

export class AgentCompensationService {
  policy() { return SRA_AGENT_COMPENSATION_POLICY; }
  quote(agentId, overrides={}) {
    const benchmark=getSraAgentCompensation(agentId);
    if(!benchmark) return {agentId, amount:0, currency:SRA_AGENT_COMPENSATION_POLICY.currency, basis:'NO_COMPENSATION_POLICY'};
    const minutes=Number(overrides.standardTaskMinutes ?? benchmark.standardTaskMinutes);
    const amount=Number(((benchmark.benchmarkHourlyUsd/60)*minutes).toFixed(2));
    return {
      agentId,
      amount,
      currency:SRA_AGENT_COMPENSATION_POLICY.currency,
      basis:'HUMAN_EQUIVALENT_TASK_VALUE',
      humanEquivalentRole:benchmark.humanEquivalentRole,
      benchmarkHourlyUsd:benchmark.benchmarkHourlyUsd,
      benchmarkAnnualUsd:benchmark.benchmarkAnnualUsd,
      humanEquivalentMinutes:minutes,
      effectiveDate:SRA_AGENT_COMPENSATION_POLICY.effectiveDate,
    };
  }
}
