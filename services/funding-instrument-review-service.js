import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  SRA_INSTRUMENT: 'SRA_INSTRUMENT',
  REVIEW: 'FUNDING_INSTRUMENT_DRAFT_REVIEW',
  FINDING: 'FUNDING_INSTRUMENT_DRAFT_REVIEW_FINDING',
  ISSUANCE_REQUEST: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST',
});

const FINDING_RESULTS = new Set(['PASS', 'CONDITION', 'FAIL', 'NOT_APPLICABLE']);
const DECISIONS = new Set(['APPROVED_FOR_ISSUANCE_REQUEST', 'CHANGES_REQUIRED', 'REJECTED']);

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export class FundingInstrumentReviewService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 6',
      purpose: 'DRAFT_INSTRUMENT_REVIEW_AND_ISSUANCE_READINESS',
      reviews: this.domain.list(TYPES.REVIEW).length,
      findings: this.domain.list(TYPES.FINDING).length,
      issuanceRequests: this.domain.list(TYPES.ISSUANCE_REQUEST).length,
    };
  }

  getInstrument(instrumentId) {
    return this.domain.get(TYPES.SRA_INSTRUMENT, instrumentId);
  }

  listReviews(filters = {}) {
    return this.domain.list(TYPES.REVIEW).filter((record) => {
      if (filters.instrumentId && record.instrumentId !== filters.instrumentId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  getReview(reviewId) {
    return this.domain.get(TYPES.REVIEW, reviewId);
  }

  listFindings(reviewId) {
    return this.domain.list(TYPES.FINDING).filter((record) => record.reviewId === reviewId);
  }

  listIssuanceRequests(filters = {}) {
    return this.domain.list(TYPES.ISSUANCE_REQUEST).filter((record) => {
      if (filters.instrumentId && record.instrumentId !== filters.instrumentId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  assessCompleteness(instrumentId) {
    const instrument = this.getInstrument(instrumentId);
    if (!instrument) throw new Error('Draft instrument was not found.');

    const required = {
      instrumentFamily: Boolean(instrument.instrumentFamily),
      fundingModel: Boolean(instrument.fundingModel),
      opportunityId: Boolean(instrument.opportunityId),
      issuerParticipantId: Boolean(instrument.issuerParticipantId),
      verifiedRecordId: Boolean(instrument.verifiedRecordId),
      purpose: Boolean(instrument.purpose),
      faceValue: Number(instrument.faceValue) > 0,
      currency: Boolean(instrument.currency),
      transferabilityStatus: Boolean(instrument.transferabilityStatus),
      settlementRule: Boolean(instrument.settlementRule),
      governingDocumentId: Boolean(instrument.governingDocumentId),
    };

    const conditional = {
      maturityDate: instrument.instrumentFamily === 'PARTICIPATION_POSITION' || instrument.instrumentFamily === 'REVENUE_PARTICIPATION_INSTRUMENT' ? true : Boolean(instrument.maturityDate),
      denomination: instrument.transferabilityStatus === 'NON_TRANSFERABLE' ? true : Boolean(instrument.denomination),
      verifiedValuePackageId: Boolean(instrument.verifiedValuePackageId),
    };

    const missingRequired = Object.entries(required).filter(([, value]) => !value).map(([field]) => field);
    const missingConditional = Object.entries(conditional).filter(([, value]) => !value).map(([field]) => field);

    return {
      instrumentId,
      complete: missingRequired.length === 0,
      required,
      conditional,
      missingRequired,
      missingConditional,
      issuanceRequestEligible: missingRequired.length === 0,
    };
  }

  async startReview(instrumentId, input = {}, actorId = null) {
    const instrument = this.getInstrument(instrumentId);
    if (!instrument) throw new Error('Draft instrument was not found.');
    if (instrument.state !== 'DRAFT' || instrument.issuanceStatus !== 'NOT_ISSUED') {
      throw new Error('Only an unissued draft instrument can enter Phase 6 review.');
    }

    const existing = this.domain.list(TYPES.REVIEW).find((record) => record.instrumentId === instrumentId && ['IN_REVIEW', 'CHANGES_REQUIRED'].includes(record.status));
    if (existing) return existing;

    const review = {
      reviewId: input.reviewId || id('FIDR'),
      instrumentId,
      opportunityId: instrument.opportunityId,
      reviewScope: input.reviewScope || [
        'INSTRUMENT_IDENTITY',
        'ISSUER_AUTHORITY',
        'VERIFIED_VALUE_LINKAGE',
        'AMOUNT_AND_CURRENCY',
        'TERMS_AND_MATURITY',
        'TRANSFERABILITY',
        'SETTLEMENT_RULE',
        'GOVERNING_DOCUMENT',
      ],
      completeness: this.assessCompleteness(instrumentId),
      status: 'IN_REVIEW',
      startedBy: actorId,
      startedAt: now(),
      decidedBy: null,
      decidedAt: null,
      decision: null,
      rationale: null,
    };

    await this.domain.put(TYPES.REVIEW, review.reviewId, review, { actorId, eventType: 'FUNDING_INSTRUMENT_DRAFT_REVIEW_STARTED' });
    await this.domain.put(TYPES.SRA_INSTRUMENT, instrumentId, {
      ...instrument,
      status: 'UNDER_REVIEW',
      reviewId: review.reviewId,
      updatedAt: now(),
    }, { actorId, eventType: 'SRA_INSTRUMENT_DRAFT_REVIEW_STARTED' });
    return review;
  }

  async recordFinding(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error('Draft review was not found.');
    if (review.status !== 'IN_REVIEW') throw new Error('Draft review must be in review before findings are recorded.');
    if (!input?.checkType || !input?.result) throw new Error('checkType and result are required.');
    if (!FINDING_RESULTS.has(input.result)) throw new Error(`Unsupported review finding result: ${input.result}`);

    const finding = {
      findingId: input.findingId || id('FIDF'),
      reviewId,
      instrumentId: review.instrumentId,
      checkType: input.checkType,
      result: input.result,
      material: input.material !== false,
      note: input.note || null,
      condition: input.condition || null,
      sourceRecordIds: unique(input.sourceRecordIds || []),
      recordedBy: actorId,
      recordedAt: now(),
    };
    await this.domain.put(TYPES.FINDING, finding.findingId, finding, { actorId, eventType: 'FUNDING_INSTRUMENT_DRAFT_REVIEW_FINDING_RECORDED' });
    return finding;
  }

  summarize(reviewId) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error('Draft review was not found.');
    const findings = this.listFindings(reviewId);
    const coveredChecks = unique(findings.map((finding) => finding.checkType));
    const missingChecks = (review.reviewScope || []).filter((check) => !coveredChecks.includes(check));
    const failures = findings.filter((finding) => finding.result === 'FAIL' && finding.material);
    const conditions = findings.filter((finding) => finding.result === 'CONDITION' && finding.material);
    const completeness = this.assessCompleteness(review.instrumentId);

    return {
      reviewId,
      instrumentId: review.instrumentId,
      coveredChecks,
      missingChecks,
      failures,
      conditions,
      completeness,
      readyForIssuanceRequestDecision: missingChecks.length === 0 && failures.length === 0 && completeness.issuanceRequestEligible,
      suggestedDecision: failures.length || !completeness.issuanceRequestEligible ? 'CHANGES_REQUIRED' : missingChecks.length ? 'CHANGES_REQUIRED' : 'APPROVED_FOR_ISSUANCE_REQUEST',
    };
  }

  async decide(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error('Draft review was not found.');
    if (review.status !== 'IN_REVIEW') throw new Error('Draft review must be in review before a decision is recorded.');
    if (!DECISIONS.has(input?.decision)) throw new Error(`Unsupported draft review decision: ${input?.decision}`);

    const summary = this.summarize(reviewId);
    if (input.decision === 'APPROVED_FOR_ISSUANCE_REQUEST' && !summary.readyForIssuanceRequestDecision) {
      const error = new Error('Draft instrument is not ready for an issuance request.');
      error.code = 'DRAFT_REVIEW_INCOMPLETE';
      error.summary = summary;
      throw error;
    }

    const decidedAt = now();
    const updatedReview = {
      ...review,
      status: input.decision === 'APPROVED_FOR_ISSUANCE_REQUEST' ? 'APPROVED' : input.decision,
      decision: input.decision,
      rationale: input.rationale || null,
      summary,
      decidedBy: actorId,
      decidedAt,
    };
    await this.domain.put(TYPES.REVIEW, reviewId, updatedReview, { actorId, eventType: 'FUNDING_INSTRUMENT_DRAFT_REVIEW_DECIDED' });

    const instrument = this.getInstrument(review.instrumentId);
    const instrumentStatus = input.decision === 'APPROVED_FOR_ISSUANCE_REQUEST' ? 'ISSUANCE_REQUEST_READY' : input.decision === 'CHANGES_REQUIRED' ? 'CHANGES_REQUIRED' : 'REJECTED';
    await this.domain.put(TYPES.SRA_INSTRUMENT, instrument.instrumentId, {
      ...instrument,
      status: instrumentStatus,
      reviewDecision: input.decision,
      reviewCompletedAt: decidedAt,
      updatedAt: decidedAt,
    }, { actorId, eventType: 'SRA_INSTRUMENT_DRAFT_REVIEW_DECIDED' });

    const opportunity = this.domain.get(TYPES.OPPORTUNITY, instrument.opportunityId);
    if (opportunity) {
      await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, {
        ...opportunity,
        status: input.decision === 'APPROVED_FOR_ISSUANCE_REQUEST' ? 'INSTRUMENT_REVIEWED' : input.decision,
        fundingPhase: input.decision === 'APPROVED_FOR_ISSUANCE_REQUEST' ? 'ISSUANCE_REQUEST_READY' : 'INSTRUMENT_DRAFT_REVIEW',
        updatedAt: decidedAt,
      }, { actorId, eventType: 'FUNDING_OPPORTUNITY_INSTRUMENT_REVIEW_DECIDED' });
    }

    return { review: updatedReview, instrument: this.getInstrument(review.instrumentId) };
  }

  async createIssuanceRequest(reviewId, input = {}, actorId = null) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error('Draft review was not found.');
    if (review.decision !== 'APPROVED_FOR_ISSUANCE_REQUEST') throw new Error('Draft review must approve issuance-request readiness first.');

    const instrument = this.getInstrument(review.instrumentId);
    if (!instrument) throw new Error('Draft instrument was not found.');
    const existing = this.domain.list(TYPES.ISSUANCE_REQUEST).find((record) => record.instrumentId === instrument.instrumentId && record.status === 'PENDING');
    if (existing) return existing;

    const request = {
      issuanceRequestId: input.issuanceRequestId || id('FIIR'),
      instrumentId: instrument.instrumentId,
      opportunityId: instrument.opportunityId,
      reviewId,
      instrumentFamily: instrument.instrumentFamily,
      issuerParticipantId: instrument.issuerParticipantId,
      faceValue: instrument.faceValue,
      currency: instrument.currency,
      requestedIssueDate: input.requestedIssueDate || null,
      requestedMaturityDate: input.requestedMaturityDate || instrument.maturityDate || null,
      issuanceMethod: input.issuanceMethod || 'SRA_CONTROLLED_ISSUANCE',
      issuanceConditions: unique([...(input.issuanceConditions || []), ...(review.summary?.conditions || []).map((finding) => finding.condition)]),
      status: 'PENDING',
      requestedBy: actorId,
      requestedAt: now(),
      approvedAt: null,
      issuedAt: null,
      transactionId: null,
    };

    await this.domain.put(TYPES.ISSUANCE_REQUEST, request.issuanceRequestId, request, { actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST_CREATED' });
    await this.domain.put(TYPES.SRA_INSTRUMENT, instrument.instrumentId, {
      ...instrument,
      status: 'ISSUANCE_REQUEST_PENDING',
      issuanceRequestId: request.issuanceRequestId,
      updatedAt: now(),
    }, { actorId, eventType: 'SRA_INSTRUMENT_ISSUANCE_REQUEST_LINKED' });

    const opportunity = this.domain.get(TYPES.OPPORTUNITY, instrument.opportunityId);
    if (opportunity) {
      await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, {
        ...opportunity,
        status: 'ISSUANCE_REQUESTED',
        fundingPhase: 'ISSUANCE_REVIEW',
        issuanceRequestId: request.issuanceRequestId,
        updatedAt: now(),
      }, { actorId, eventType: 'FUNDING_OPPORTUNITY_ISSUANCE_REQUESTED' });
    }

    await this.domain.lifecycle({
      objectType: TYPES.SRA_INSTRUMENT,
      objectId: instrument.instrumentId,
      eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST_CREATED',
      actorId,
      payload: { issuanceRequestId: request.issuanceRequestId, issuanceStatus: instrument.issuanceStatus },
    });

    return request;
  }
}

export { TYPES as FUNDING_INSTRUMENT_REVIEW_RECORD_TYPES };
