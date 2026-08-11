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
  INSTRUMENT: 'SRA_INSTRUMENT',
  INSTRUMENT_REVIEW: 'FUNDING_INSTRUMENT_DRAFT_REVIEW',
  ISSUANCE_REQUEST: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST',
  LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  POSITION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION',
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

  queue(filters = {}) {
    return newest(this.domain.list(RECORDS.OPPORTUNITY), Number(filters.limit) || 100)
      .filter((record) => !filters.status || record.status === filters.status)
      .map((record) => ({
        opportunityId: record.opportunityId,
        title: record.title,
        applicantParticipantId: record.applicantParticipantId,
        opportunityType: record.opportunityType,
        requestedAmount: record.requestedAmount,
        currency: record.currency,
        status: record.status,
        fundingPhase: record.fundingPhase,
        updatedAt: record.updatedAt || record.createdAt,
      }));
  }

  opportunityDetail(opportunityId) {
    const opportunity = this.domain.get(RECORDS.OPPORTUNITY, opportunityId);
    if (!opportunity) return null;
    const evidence = related(this.domain.list(RECORDS.EVIDENCE), opportunityId);
    const verificationRequests = related(this.domain.list(RECORDS.VERIFICATION_REQUEST), opportunityId);
    const requestIds = new Set(verificationRequests.map((record) => record.verificationRequestId));
    const verificationFindings = this.domain.list(RECORDS.VERIFICATION_FINDING).filter((record) => requestIds.has(record.verificationRequestId));
    const verificationDecisions = related(this.domain.list(RECORDS.VERIFICATION_DECISION), opportunityId);
    const preparations = related(this.domain.list(RECORDS.VALUE_PREPARATION), opportunityId);
    const modelAssessments = related(this.domain.list(RECORDS.MODEL_ASSESSMENT), opportunityId);
    const modelSelections = related(this.domain.list(RECORDS.MODEL_SELECTION), opportunityId);
    const instrumentRequests = related(this.domain.list(RECORDS.INSTRUMENT_REQUEST), opportunityId);
    const instrumentSelections = related(this.domain.list(RECORDS.INSTRUMENT_SELECTION), opportunityId);
    const instruments = related(this.domain.list(RECORDS.INSTRUMENT), opportunityId);
    const listings = related(this.domain.list(RECORDS.LISTING), opportunityId);
    const commitments = related(this.domain.list(RECORDS.COMMITMENT), opportunityId);
    const positions = related(this.domain.list(RECORDS.POSITION), opportunityId);
    const settlements = related(this.domain.list(RECORDS.SETTLEMENT_PREPARATION), opportunityId);

    return {
      opportunity,
      intake: {
        completeness: opportunity.completeness || null,
        evidence,
        supportingDocumentIds: opportunity.supportingDocumentIds || [],
        relatedAgreementIds: opportunity.relatedAgreementIds || [],
        sourceTransactionIds: opportunity.sourceTransactionIds || [],
      },
      verification: { requests: verificationRequests, findings: verificationFindings, decisions: verificationDecisions },
      valuePreparation: preparations,
      modelAssessments,
      modelSelections,
      instrumentRequests,
      instrumentSelections,
      instruments,
      listings,
      commitments,
      positions,
      settlements,
      timeline: opportunity.history || [],
    };
  }

  dashboard() {
    const opportunities = this.domain.list(RECORDS.OPPORTUNITY);
    const queue = this.queue();
    const totalRequested = opportunities.reduce((sum, record) => sum + Number(record.requestedAmount || 0), 0);
    const statusCounts = opportunities.reduce((acc, record) => {
      const key = record.status || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      generatedAt: new Date().toISOString(),
      metrics: {
        opportunities: opportunities.length,
        totalRequested,
        activeQueueItems: queue.filter((item) => !['POSITION_SETTLED', 'WITHDRAWN', 'VERIFICATION_CLOSED'].includes(item.status)).length,
        liveListings: this.domain.list(RECORDS.LISTING).filter((record) => record.state === 'LIVE').length,
        confirmedCommitments: this.domain.list(RECORDS.COMMITMENT).filter((record) => record.status === 'CONFIRMED').length,
        recognizedPositions: this.domain.list(RECORDS.POSITION).filter((record) => record.ownershipStatus === 'RECOGNIZED').length,
      },
      opportunityStatusCounts: statusCounts,
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

export { RECORDS as FUNDING_OPERATIONS_RECORD_TYPES };
