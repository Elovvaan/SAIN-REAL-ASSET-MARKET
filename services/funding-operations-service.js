import { FINANCING_STAGES, normalizeFinancingStage } from './financing-lifecycle-service.js';

const RECORDS = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  EVIDENCE: 'FUNDING_OPPORTUNITY_EVIDENCE',
  VERIFICATION_REQUEST: 'FUNDING_OPPORTUNITY_VERIFICATION_REQUEST',
  VERIFICATION_FINDING: 'FUNDING_OPPORTUNITY_VERIFICATION_FINDING',
  VERIFICATION_DECISION: 'FUNDING_OPPORTUNITY_VERIFICATION_DECISION',
  VALUE_PREPARATION: 'FUNDING_OPPORTUNITY_VALUE_PREPARATION',
  MODEL_ASSESSMENT: 'FUNDING_MODEL_ASSESSMENT',
  MODEL_SELECTION: 'FUNDING_MODEL_SELECTION',
  INSTRUMENT_REQUEST: 'FUNDING_INSTRUMENT_SELECTION_REQUEST',
  INSTRUMENT_SELECTION: 'FUNDING_INSTRUMENT_SELECTION',
  LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  POSITION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION',
  INSTRUMENT: 'SRA_INSTRUMENT',
  RVU_RECOGNITION: 'SRA_RVU_RECOGNITION',
  SETTLEMENT_EQUIVALENCE: 'SRA_SETTLEMENT_EQUIVALENCE',
});

function newest(records, limit = 25) {
  return [...records]
    .sort((a, b) => String(b.updatedAt || b.createdAt || b.recordedAt || '').localeCompare(String(a.updatedAt || a.createdAt || a.recordedAt || '')))
    .slice(0, limit);
}

function related(records, opportunityId) {
  return records.filter((record) => record.opportunityId === opportunityId);
}

export class FundingOperationsService {
  constructor(persistentDomain) { this.domain = persistentDomain; }

  async initialize() {
    await this.domain.hydrate(Object.values(RECORDS));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Operations',
      purpose: 'UNIFIED_FUNDING_ENGINE_OPERATIONS',
      opportunities: this.domain.list(RECORDS.OPPORTUNITY).length,
      activeQueueItems: this.queue().length,
    };
  }

  structure() {
    return [...FINANCING_STAGES];
  }

  phaseSummary() {
    const counts = this.domain.list(RECORDS.OPPORTUNITY).reduce((result, record) => {
      const stage = normalizeFinancingStage(record);
      result[stage] = (result[stage] || 0) + 1;
      return result;
    }, {});
    return this.structure().map((stage) => ({ stage, count: counts[stage] || 0 }));
  }

  queue(filters = {}) {
    const requestedStage = filters.status ? String(filters.status).toUpperCase() : null;
    return newest(this.domain.list(RECORDS.OPPORTUNITY), Number(filters.limit) || 100)
      .filter((record) => !requestedStage || normalizeFinancingStage(record) === requestedStage)
      .map((record) => {
        const financingStage = normalizeFinancingStage(record);
        return {
          opportunityId: record.opportunityId,
          title: record.title,
          applicantParticipantId: record.applicantParticipantId,
          opportunityType: record.opportunityType,
          proposedTransactionStructure: record.proposedTransactionStructure || null,
          approvedTransactionStructure: record.approvedTransactionStructure || null,
          requestedAmount: record.requestedAmount,
          currency: record.currency,
          status: financingStage,
          financingStage,
          legacyStatus: record.status,
          updatedAt: record.updatedAt || record.createdAt,
        };
      });
  }

  opportunityDetail(opportunityId) {
    const opportunity = this.domain.get(RECORDS.OPPORTUNITY, opportunityId);
    if (!opportunity) return null;
    const evidence = related(this.domain.list(RECORDS.EVIDENCE), opportunityId);
    const financingStage = normalizeFinancingStage(opportunity);
    const recognizedValues = related(this.domain.list(RECORDS.RVU_RECOGNITION), opportunityId);
    const settlementEquivalences = related(this.domain.list(RECORDS.SETTLEMENT_EQUIVALENCE), opportunityId);

    return {
      opportunity: { ...opportunity, legacyStatus: opportunity.status, status: financingStage, financingStage },
      structure: this.structure(),
      intake: {
        completeness: opportunity.completeness || null,
        evidence,
        supportingDocumentIds: opportunity.supportingDocumentIds || [],
        relatedAgreementIds: opportunity.relatedAgreementIds || [],
        sourceTransactionIds: opportunity.sourceTransactionIds || [],
      },
      verification: {
        requests: related(this.domain.list(RECORDS.VERIFICATION_REQUEST), opportunityId),
        findings: related(this.domain.list(RECORDS.VERIFICATION_FINDING), opportunityId),
        decisions: related(this.domain.list(RECORDS.VERIFICATION_DECISION), opportunityId),
      },
      valuePreparation: related(this.domain.list(RECORDS.VALUE_PREPARATION), opportunityId),
      modelAssessments: related(this.domain.list(RECORDS.MODEL_ASSESSMENT), opportunityId),
      modelSelections: related(this.domain.list(RECORDS.MODEL_SELECTION), opportunityId),
      instrumentRequests: related(this.domain.list(RECORDS.INSTRUMENT_REQUEST), opportunityId),
      instrumentSelections: related(this.domain.list(RECORDS.INSTRUMENT_SELECTION), opportunityId),
      instruments: related(this.domain.list(RECORDS.INSTRUMENT), opportunityId),
      listings: related(this.domain.list(RECORDS.LISTING), opportunityId),
      commitments: related(this.domain.list(RECORDS.COMMITMENT), opportunityId),
      positions: related(this.domain.list(RECORDS.POSITION), opportunityId),
      settlements: related(this.domain.list(RECORDS.SETTLEMENT), opportunityId),
      timeline: opportunity.financingHistory || opportunity.history || [],
      recognizedValues,
      settlementEquivalences,
    };
  }

  dashboard() {
    const opportunities = this.domain.list(RECORDS.OPPORTUNITY);
    const queue = this.queue();
    const totalRequested = opportunities.reduce((sum, record) => sum + Number(record.requestedAmount || 0), 0);
    const recognizedValues = this.domain.list(RECORDS.RVU_RECOGNITION);
    const stageCounts = opportunities.reduce((acc, record) => {
      const key = normalizeFinancingStage(record);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      generatedAt: new Date().toISOString(),
      structure: this.structure(),
      metrics: {
        opportunities: opportunities.length,
        totalRequested,
        activeQueueItems: queue.filter((item) => item.financingStage !== 'CLOSED').length,
        liveListings: this.domain.list(RECORDS.LISTING).filter((record) => record.state === 'LIVE').length,
        confirmedCommitments: this.domain.list(RECORDS.COMMITMENT).filter((record) => record.status === 'CONFIRMED').length,
        recognizedPositions: this.domain.list(RECORDS.POSITION).filter((record) => record.ownershipStatus === 'RECOGNIZED').length,
        totalRecognizedRvu: Number(recognizedValues.reduce((sum, record) => sum + Number(record.recognizedRvu || 0), 0).toFixed(8)),
        rvuRecognizedOpportunities: new Set(recognizedValues.map((record) => record.opportunityId)).size,
        settlementEquivalences: this.domain.list(RECORDS.SETTLEMENT_EQUIVALENCE).length,
      },
      financingStageCounts: stageCounts,
      queue: queue.slice(0, 30),
      recent: {
        opportunities: newest(opportunities, 10),
        instruments: newest(this.domain.list(RECORDS.INSTRUMENT), 10),
        listings: newest(this.domain.list(RECORDS.LISTING), 10),
        positions: newest(this.domain.list(RECORDS.POSITION), 10),
      },
    };
  }
}

export { RECORDS as FUNDING_OPERATIONS_RECORD_TYPES, FINANCING_STAGES as FINANCING_STRUCTURE };
