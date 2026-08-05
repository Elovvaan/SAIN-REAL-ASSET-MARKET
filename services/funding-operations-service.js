const RECORDS = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  VERIFICATION_REQUEST: 'FUNDING_OPPORTUNITY_VERIFICATION_REQUEST',
  VALUE_PREPARATION: 'FUNDING_OPPORTUNITY_VALUE_PREPARATION',
  MODEL_SELECTION: 'FUNDING_MODEL_SELECTION',
  INSTRUMENT_SELECTION: 'FUNDING_INSTRUMENT_SELECTION',
  INSTRUMENT: 'SRA_INSTRUMENT',
  INSTRUMENT_REVIEW: 'FUNDING_INSTRUMENT_DRAFT_REVIEW',
  ISSUANCE_REQUEST: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST',
  LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  POSITION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION',
});

const PHASES = Object.freeze([
  ['OPPORTUNITY_INTAKE', RECORDS.OPPORTUNITY],
  ['VERIFICATION', RECORDS.VERIFICATION_REQUEST],
  ['VALUE_PREPARATION', RECORDS.VALUE_PREPARATION],
  ['MODEL_SELECTION', RECORDS.MODEL_SELECTION],
  ['INSTRUMENT_SELECTION', RECORDS.INSTRUMENT_SELECTION],
  ['INSTRUMENT_REVIEW', RECORDS.INSTRUMENT_REVIEW],
  ['ISSUANCE', RECORDS.ISSUANCE_REQUEST],
  ['MARKETPLACE', RECORDS.LISTING],
  ['COMMITMENTS', RECORDS.COMMITMENT],
  ['POSITIONS', RECORDS.POSITION],
  ['SETTLEMENT_PREPARATION', RECORDS.SETTLEMENT_PREPARATION],
]);

function newest(records, limit = 25) {
  return [...records]
    .sort((a, b) => String(b.updatedAt || b.createdAt || b.recordedAt || '').localeCompare(String(a.updatedAt || a.createdAt || a.recordedAt || '')))
    .slice(0, limit);
}

function actionFor(opportunity) {
  const status = opportunity.status || 'UNKNOWN';
  const map = {
    INTAKE_IN_PROGRESS: ['Complete intake', 'INTAKE'],
    INTAKE_COMPLETE: ['Create verification request', 'VERIFICATION'],
    PENDING_VERIFICATION: ['Start verification', 'VERIFICATION'],
    VERIFICATION_IN_PROGRESS: ['Complete verification findings', 'VERIFICATION'],
    MORE_EVIDENCE_REQUIRED: ['Register additional evidence', 'EVIDENCE_REMEDIATION'],
    VERIFIED: ['Prepare Verified Value package', 'VALUE_PREPARATION'],
    VALUE_PREPARED: ['Select funding model', 'MODEL_SELECTION'],
    FUNDING_MODEL_SELECTED: ['Select instrument family', 'INSTRUMENT_SELECTION'],
    INSTRUMENT_DRAFTED: ['Review draft instrument', 'INSTRUMENT_REVIEW'],
    INSTRUMENT_REVIEWED: ['Create issuance request', 'ISSUANCE'],
    ISSUANCE_REQUESTED: ['Review issuance request', 'ISSUANCE'],
    INSTRUMENT_ISSUED: ['Prepare marketplace listing', 'MARKETPLACE'],
    MARKETPLACE_LISTING_PREPARED: ['Review marketplace publication', 'PUBLICATION'],
    MARKETPLACE_LIVE: ['Open commitments', 'COMMITMENTS'],
    ALLOCATION_CREATED: ['Prepare settlement', 'SETTLEMENT'],
    POSITION_SETTLED: ['Lifecycle monitoring', 'LIFECYCLE'],
  };
  const [label, queue] = map[status] || ['Review opportunity', 'GENERAL_REVIEW'];
  return { label, queue };
}

export class FundingOperationsService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

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

  phaseSummary() {
    return PHASES.map(([phase, recordType], index) => {
      const records = this.domain.list(recordType);
      const statusCounts = records.reduce((acc, record) => {
        const key = record.status || record.state || 'UNKNOWN';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      return { phaseNumber: index + 1, phase, recordType, count: records.length, statusCounts };
    });
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
        nextAction: actionFor(record),
        updatedAt: record.updatedAt || record.createdAt,
      }));
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
      phases: this.phaseSummary(),
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
