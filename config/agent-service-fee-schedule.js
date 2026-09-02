import { SRA_AGENT_COMPENSATION_POLICY } from './agent-compensation-policy.js';

const fee = (agentId, feeCode, serviceName, workflowStages=[]) => {
  const compensation = SRA_AGENT_COMPENSATION_POLICY.agents[agentId];
  return Object.freeze({
    agentId,
    feeCode,
    serviceName,
    currency: SRA_AGENT_COMPENSATION_POLICY.currency,
    amount: compensation?.standardTaskCompensationUsd || 0,
    valuationBasis: SRA_AGENT_COMPENSATION_POLICY.valuationMethod,
    humanEquivalentRole: compensation?.humanEquivalentRole || null,
    humanEquivalentMinutes: compensation?.standardTaskMinutes || null,
    effectiveDate: SRA_AGENT_COMPENSATION_POLICY.effectiveDate,
    workflowStages: Object.freeze([...workflowStages]),
  });
};

export const SRA_AGENT_SERVICE_FEE_SCHEDULE = Object.freeze({
  scheduleId: 'SRA-AGENT-SERVICE-FEES-2026-08-21',
  version: '2026.08.21',
  currency: SRA_AGENT_COMPENSATION_POLICY.currency,
  basis: 'SRA_SERVICE_FEE_INCLUDES_AGENT_WORK_UNIT',
  effectiveDate: SRA_AGENT_COMPENSATION_POLICY.effectiveDate,
  services: Object.freeze({
    'SRA-COIN-AGENT': fee('SRA-COIN-AGENT', 'SRA-SERVICE-COIN-OPS', 'Coin Operations Service', ['COIN_POSITION','INSTRUMENT_REPRESENTATION','ON_CHAIN_REPRESENTATION','ON_CHAIN_RECONCILIATION']),
    'SRA-LISTING-AGENT': fee('SRA-LISTING-AGENT', 'SRA-SERVICE-LISTING-OPS', 'Listing Operations Service', ['LISTING_PREPARATION','LISTING_PUBLICATION']),
    'SRA-ORDER-AGENT': fee('SRA-ORDER-AGENT', 'SRA-SERVICE-ORDER-OPS', 'Order Operations Service', ['ORDER_INTENT','MATCH_REVIEW','RESERVATION']),
    'SRA-SETTLEMENT-AGENT': fee('SRA-SETTLEMENT-AGENT', 'SRA-SERVICE-SETTLEMENT-OPS', 'Settlement Operations Service', ['ALLOCATION']),
    'SRA-EXPORT-AGENT': fee('SRA-EXPORT-AGENT', 'SRA-SERVICE-EXPORT-OPS', 'Export and External Transfer Service', ['SETTLEMENT','EXPORT_PACKAGE','TRANSFER_INSTRUCTION','EXTERNAL_EXECUTION','TRANSFER_EXCEPTION','EXPORT_EXCEPTION']),
    'SRA-MARKETPLACE-AGENT': fee('SRA-MARKETPLACE-AGENT', 'SRA-SERVICE-MARKETPLACE-OPS', 'Marketplace Operations Service', ['MARKETPLACE_READINESS','MARKET_OFFER']),
  }),
});

export const SRA_WORKFLOW_STAGE_SERVICE_MAP = Object.freeze(
  Object.values(SRA_AGENT_SERVICE_FEE_SCHEDULE.services).reduce((map, service) => {
    for (const stage of service.workflowStages) map[stage] = service.agentId;
    return map;
  }, {})
);

export function getSraAgentServiceFee(agentId) {
  return SRA_AGENT_SERVICE_FEE_SCHEDULE.services[String(agentId || '').trim()] || null;
}

export function getSraWorkflowServiceFee(stage) {
  const agentId = SRA_WORKFLOW_STAGE_SERVICE_MAP[String(stage || '').trim().toUpperCase()];
  return agentId ? getSraAgentServiceFee(agentId) : null;
}
