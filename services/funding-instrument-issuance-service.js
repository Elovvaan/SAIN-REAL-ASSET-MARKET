import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  SRA_INSTRUMENT: 'SRA_INSTRUMENT',
  ISSUANCE_REQUEST: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST',
  ISSUANCE_REVIEW: 'FUNDING_INSTRUMENT_ISSUANCE_REVIEW',
  ISSUANCE_AUTHORIZATION: 'FUNDING_INSTRUMENT_ISSUANCE_AUTHORIZATION',
  SRA_TRANSACTION: 'SRA_TRANSACTION',
});

const DECISIONS = new Set(['AUTHORIZED', 'CHANGES_REQUIRED', 'REJECTED']);

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export class FundingInstrumentIssuanceService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 7',
      purpose: 'CONTROLLED_INSTRUMENT_ISSUANCE',
      issuanceReviews: this.domain.list(TYPES.ISSUANCE_REVIEW).length,
      authorizations: this.domain.list(TYPES.ISSUANCE_AUTHORIZATION).length,
      issuanceTransactions: this.domain.list(TYPES.SRA_TRANSACTION).filter((record) => record.transactionType === 'INSTRUMENT_ISSUANCE').length,
    };
  }

  getRequest(requestId) {
    return this.domain.get(TYPES.ISSUANCE_REQUEST, requestId);
  }

  getReview(reviewId) {
    return this.domain.get(TYPES.ISSUANCE_REVIEW, reviewId);
  }

  listReviews(filters = {}) {
    return this.domain.list(TYPES.ISSUANCE_REVIEW).filter((record) => {
      if (filters.issuanceRequestId && record.issuanceRequestId !== filters.issuanceRequestId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  listAuthorizations(filters = {}) {
    return this.domain.list(TYPES.ISSUANCE_AUTHORIZATION).filter((record) => {
      if (filters.instrumentId && record.instrumentId !== filters.instrumentId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  assessRequest(requestId) {
    const request = this.getRequest(requestId);
    if (!request) throw new Error('Issuance request was not found.');
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, request.instrumentId);
    if (!instrument) throw new Error('Instrument was not found.');

    const checks = {
      requestPending: request.status === 'PENDING',
      instrumentDraft: instrument.state === 'DRAFT',
      instrumentNotIssued: instrument.issuanceStatus === 'NOT_ISSUED',
      issuerPresent: Boolean(request.issuerParticipantId),
      faceValueValid: Number(request.faceValue) > 0,
      currencyPresent: Boolean(request.currency),
      reviewApproved: instrument.reviewDecision === 'APPROVED_FOR_ISSUANCE_REQUEST',
      verifiedRecordLinked: Boolean(instrument.verifiedRecordId),
      settlementRulePresent: Boolean(instrument.settlementRule),
      governingDocumentPresent: Boolean(instrument.governingDocumentId),
    };

    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return {
      issuanceRequestId: requestId,
      instrumentId: instrument.instrumentId,
      checks,
      blockers,
      readyForAuthorization: blockers.length === 0,
    };
  }

  async startReview(requestId, input = {}, actorId = null) {
    const request = this.getRequest(requestId);
    if (!request) throw new Error('Issuance request was not found.');
    if (request.status !== 'PENDING') throw new Error(`Issuance review cannot begin from ${request.status}.`);

    const existing = this.domain.list(TYPES.ISSUANCE_REVIEW).find((record) => record.issuanceRequestId === requestId && record.status === 'IN_REVIEW');
    if (existing) return existing;

    const review = {
      issuanceReviewId: input.issuanceReviewId || id('FIUR'),
      issuanceRequestId: requestId,
      instrumentId: request.instrumentId,
      opportunityId: request.opportunityId,
      assessment: this.assessRequest(requestId),
      status: 'IN_REVIEW',
      startedBy: actorId,
      startedAt: now(),
      decision: null,
      rationale: null,
      decidedBy: null,
      decidedAt: null,
    };
    await this.domain.put(TYPES.ISSUANCE_REVIEW, review.issuanceReviewId, review, { actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REVIEW_STARTED' });
    await this.domain.put(TYPES.ISSUANCE_REQUEST, requestId, { ...request, status: 'IN_REVIEW', issuanceReviewId: review.issuanceReviewId, updatedAt: now() }, { actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST_IN_REVIEW' });
    return review;
  }

  async decide(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error('Issuance review was not found.');
    if (review.status !== 'IN_REVIEW') throw new Error('Issuance review must be in review before a decision is recorded.');
    if (!DECISIONS.has(input?.decision)) throw new Error(`Unsupported issuance review decision: ${input?.decision}`);

    const assessment = this.assessRequest(review.issuanceRequestId);
    if (input.decision === 'AUTHORIZED' && !assessment.readyForAuthorization) {
      const error = new Error('Issuance request is not ready for authorization.');
      error.code = 'ISSUANCE_REVIEW_INCOMPLETE';
      error.assessment = assessment;
      throw error;
    }

    const decidedAt = now();
    const updatedReview = {
      ...review,
      assessment,
      status: input.decision,
      decision: input.decision,
      rationale: input.rationale || null,
      decidedBy: actorId,
      decidedAt,
    };
    await this.domain.put(TYPES.ISSUANCE_REVIEW, reviewId, updatedReview, { actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REVIEW_DECIDED' });

    const request = this.getRequest(review.issuanceRequestId);
    const requestStatus = input.decision === 'AUTHORIZED' ? 'AUTHORIZED' : input.decision;
    await this.domain.put(TYPES.ISSUANCE_REQUEST, request.issuanceRequestId, {
      ...request,
      status: requestStatus,
      authorizationDecision: input.decision,
      authorizationRationale: input.rationale || null,
      approvedAt: input.decision === 'AUTHORIZED' ? decidedAt : request.approvedAt,
      updatedAt: decidedAt,
    }, { actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST_DECIDED' });

    let authorization = null;
    if (input.decision === 'AUTHORIZED') {
      authorization = {
        issuanceAuthorizationId: id('FIAU'),
        issuanceRequestId: request.issuanceRequestId,
        issuanceReviewId: reviewId,
        instrumentId: request.instrumentId,
        opportunityId: request.opportunityId,
        authorizedFaceValue: request.faceValue,
        currency: request.currency,
        authorizedIssueDate: input.authorizedIssueDate || request.requestedIssueDate || null,
        authorizedMaturityDate: input.authorizedMaturityDate || request.requestedMaturityDate || null,
        conditions: unique([...(request.issuanceConditions || []), ...(input.conditions || [])]),
        status: 'AUTHORIZED',
        authorizedBy: actorId,
        authorizedAt: decidedAt,
        consumedAt: null,
        issuanceTransactionId: null,
      };
      await this.domain.put(TYPES.ISSUANCE_AUTHORIZATION, authorization.issuanceAuthorizationId, authorization, { actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_AUTHORIZED' });
    }

    return { review: updatedReview, authorization };
  }

  async issue(authorizationId, input = {}, actorId = null) {
    const authorization = this.domain.get(TYPES.ISSUANCE_AUTHORIZATION, authorizationId);
    if (!authorization) throw new Error('Issuance authorization was not found.');
    if (authorization.status !== 'AUTHORIZED' || authorization.consumedAt) throw new Error('Issuance authorization is not available for use.');

    const request = this.getRequest(authorization.issuanceRequestId);
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, authorization.instrumentId);
    if (!request || !instrument) throw new Error('Required issuance records were not found.');
    if (instrument.issuanceStatus !== 'NOT_ISSUED') throw new Error('Instrument has already been issued or otherwise closed.');

    const issuedAt = input.issuedAt || now();
    const transaction = {
      transactionId: input.transactionId || id('SRATX'),
      transactionType: 'INSTRUMENT_ISSUANCE',
      instrumentId: instrument.instrumentId,
      opportunityId: instrument.opportunityId,
      issuerParticipantId: instrument.issuerParticipantId,
      issuanceAuthorizationId: authorizationId,
      amount: authorization.authorizedFaceValue,
      currency: authorization.currency,
      issueDate: authorization.authorizedIssueDate || issuedAt,
      maturityDate: authorization.authorizedMaturityDate || instrument.maturityDate || null,
      governingDocumentId: instrument.governingDocumentId,
      settlementRule: instrument.settlementRule,
      state: 'RECORDED',
      status: 'RECORDED',
      recordedBy: actorId,
      recordedAt: issuedAt,
    };
    await this.domain.put(TYPES.SRA_TRANSACTION, transaction.transactionId, transaction, { actorId, eventType: 'SRA_INSTRUMENT_ISSUANCE_RECORDED' });

    const issuedInstrument = {
      ...instrument,
      state: 'ISSUED',
      status: 'ACTIVE',
      issuanceStatus: 'ISSUED',
      issuanceAuthorizationId: authorizationId,
      issuanceTransactionId: transaction.transactionId,
      issueDate: transaction.issueDate,
      maturityDate: transaction.maturityDate,
      issuedBy: actorId,
      issuedAt,
      updatedAt: issuedAt,
    };
    await this.domain.put(TYPES.SRA_INSTRUMENT, instrument.instrumentId, issuedInstrument, { actorId, eventType: 'SRA_INSTRUMENT_ISSUED' });
    await this.domain.put(TYPES.ISSUANCE_AUTHORIZATION, authorizationId, { ...authorization, status: 'CONSUMED', consumedAt: issuedAt, issuanceTransactionId: transaction.transactionId }, { actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_AUTHORIZATION_CONSUMED' });
    await this.domain.put(TYPES.ISSUANCE_REQUEST, request.issuanceRequestId, { ...request, status: 'ISSUED', issuedAt, transactionId: transaction.transactionId, updatedAt: issuedAt }, { actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_COMPLETED' });

    const opportunity = this.domain.get(TYPES.OPPORTUNITY, instrument.opportunityId);
    if (opportunity) {
      await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, {
        ...opportunity,
        status: 'INSTRUMENT_ISSUED',
        fundingPhase: 'MARKETPLACE_PREPARATION',
        issuanceTransactionId: transaction.transactionId,
        updatedAt: issuedAt,
        history: [...(opportunity.history || []), { from: opportunity.status, to: 'INSTRUMENT_ISSUED', at: issuedAt, actorId, note: instrument.instrumentFamily }],
      }, { actorId, eventType: 'FUNDING_OPPORTUNITY_INSTRUMENT_ISSUED' });
    }

    await this.domain.lifecycle({
      objectType: TYPES.SRA_INSTRUMENT,
      objectId: instrument.instrumentId,
      eventType: 'FUNDING_INSTRUMENT_ISSUED',
      actorId,
      payload: {
        issuanceAuthorizationId: authorizationId,
        transactionId: transaction.transactionId,
        faceValue: transaction.amount,
        currency: transaction.currency,
        marketplaceStatus: 'NOT_LISTED',
        onChainStatus: 'NOT_PROJECTED',
      },
    });

    return { instrument: issuedInstrument, transaction };
  }
}

export { TYPES as FUNDING_INSTRUMENT_ISSUANCE_RECORD_TYPES };
