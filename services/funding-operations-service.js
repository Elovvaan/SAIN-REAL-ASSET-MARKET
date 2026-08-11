const RECORDS = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  EVIDENCE: 'FUNDING_OPPORTUNITY_EVIDENCE',
  LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  POSITION: 'FUNDING_MARKETPLACE_POSITION',
  INSTRUMENT: 'SRA_INSTRUMENT',
});

const FINANCING_STRUCTURE = Object.freeze([
  'APPLICATION_OPPORTUNITY',
  'UNDERWRITING',
  'CREDIT_DECISION',
  'DOCUMENTATION',
  'CLOSING',
  'FUNDING_DISBURSEMENT',
  'SERVICING',
]);

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
    return [...FINANCING_STRUCTURE];
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

    return {
      opportunity,
      structure: this.structure(),
      intake: {
        completeness: opportunity.completeness || null,
        evidence,
        supportingDocumentIds: opportunity.supportingDocumentIds || [],
        relatedAgreementIds: opportunity.relatedAgreementIds || [],
        sourceTransactionIds: opportunity.sourceTransactionIds || [],
      },
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
      structure: this.structure(),
      metrics: {
        opportunities: opportunities.length,
        totalRequested,
        activeQueueItems: queue.filter((item) => !['WITHDRAWN', 'CLOSED'].includes(item.status)).length,
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

export { RECORDS as FUNDING_OPERATIONS_RECORD_TYPES, FINANCING_STRUCTURE };
