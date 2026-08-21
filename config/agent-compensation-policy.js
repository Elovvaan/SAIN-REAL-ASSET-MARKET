// SRA agent compensation policy.
// Benchmark basis: 2026 U.S. human-equivalent market compensation for comparable work.
// SRA values completed work by the human-equivalent task, not by machine runtime.
// Rates are private SRA compensation policy and are not a claim of a universal AI-agent wage.

export const SRA_AGENT_COMPENSATION_POLICY = Object.freeze({
  currency: 'USD',
  valuationMethod: 'HUMAN_EQUIVALENT_TASK_VALUE',
  effectiveDate: '2026-08-21',
  agents: Object.freeze({
    'SRA-COIN-AGENT': Object.freeze({
      humanEquivalentRole: 'Digital Operations Analyst',
      benchmarkAnnualUsd: 69168,
      benchmarkHourlyUsd: 33,
      standardTaskMinutes: 30,
      standardTaskCompensationUsd: 16.50,
    }),
    'SRA-LISTING-AGENT': Object.freeze({
      humanEquivalentRole: 'Listing Specialist',
      benchmarkAnnualUsd: 75438,
      benchmarkHourlyUsd: 36,
      standardTaskMinutes: 30,
      standardTaskCompensationUsd: 18.00,
    }),
    'SRA-ORDER-AGENT': Object.freeze({
      humanEquivalentRole: 'Order Analyst',
      benchmarkAnnualUsd: 53583,
      benchmarkHourlyUsd: 26,
      standardTaskMinutes: 20,
      standardTaskCompensationUsd: 8.67,
    }),
    'SRA-SETTLEMENT-AGENT': Object.freeze({
      humanEquivalentRole: 'Settlements Analyst',
      benchmarkAnnualUsd: 73559,
      benchmarkHourlyUsd: 35,
      standardTaskMinutes: 45,
      standardTaskCompensationUsd: 26.25,
    }),
    'SRA-EXPORT-AGENT': Object.freeze({
      humanEquivalentRole: 'Import/Export Operations Specialist',
      benchmarkAnnualUsd: 67639,
      benchmarkHourlyUsd: 33,
      standardTaskMinutes: 45,
      standardTaskCompensationUsd: 24.75,
    }),
    'SRA-MARKETPLACE-AGENT': Object.freeze({
      humanEquivalentRole: 'Marketplace Specialist',
      benchmarkAnnualUsd: 70191,
      benchmarkHourlyUsd: 34,
      standardTaskMinutes: 30,
      standardTaskCompensationUsd: 17.00,
    }),
  }),
});

export function getSraAgentCompensation(agentId) {
  return SRA_AGENT_COMPENSATION_POLICY.agents[String(agentId || '').trim()] || null;
}
