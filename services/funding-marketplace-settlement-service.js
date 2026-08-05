import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  POSITION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION',
  SETTLEMENT_REVIEW: 'FUNDING_MARKETPLACE_SETTLEMENT_REVIEW',
  SETTLEMENT_AUTHORIZATION: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION',
  SRA_TRANSACTION: 'SRA_TRANSACTION',
});

const DECISIONS = new Set(['AUTHORIZED', 'CHANGES_REQUIRED', 'REJECTED']);

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

export class FundingMarketplaceSettlementService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 12',
      purpose: 'CONTROLLED_SETTLEMENT_AND_FINAL_OWNERSHIP_RECOGNITION',
      settlementReviews: this.domain.list(TYPES.SETTLEMENT_REVIEW).length,
      settlementAuthorizations: this.domain.list(TYPES.SETTLEMENT_AUTHORIZATION).length,
      settlementTransactions: this.domain.list(TYPES.SRA_TRANSACTION).filter((record) => record.transactionType === 'MARKETPLACE_SETTLEMENT').length,
    };
  }

  getPreparation(preparationId) {
    return this.domain.get(TYPES.SETTLEMENT_PREPARATION, preparationId);
  }

  getReview(reviewId) {
    return this.domain.get(TYPES.SETTLEMENT_REVIEW, reviewId);
  }

  listReviews(filters = {}) {
    return this.domain.list(TYPES.SETTLEMENT_REVIEW).filter((record) => {
      if (filters.preparationId && record.settlementPreparationId !== filters.preparationId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  listAuthorizations(filters = {}) {
    return this.domain.list(TYPES.SETTLEMENT_AUTHORIZATION).filter((record) => {
      if (filters.positionId && record.positionId !== filters.positionId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  assessPreparation(preparationId) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Settlement preparation was not found.');
    const position = this.domain.get(TYPES.POSITION, preparation.positionId);
    if (!position) throw new Error('Marketplace position was not found.');

    const checks = {
      preparationReady: preparation.status === 'PREPARED',
      settlementNotStarted: preparation.settlementStatus === 'NOT_STARTED',
      positionPrepared: position.status === 'SETTLEMENT_PREPARED',
      positionPendingSettlement: position.ownershipStatus === 'PENDING_SETTLEMENT',
      amountValid: Number(preparation.amount) > 0,
      currencyPresent: Boolean(preparation.currency),
      quantityValid: Number(preparation.quantity) > 0,
      participantPresent: Boolean(preparation.participantId),
      issuerPresent: Boolean(preparation.issuerParticipantId),
      transactionRoutePresent: Boolean(preparation.transactionRouteId),
      settlementRoutePresent: Boolean(preparation.settlementRouteId),
      paymentSourcePresent: Boolean(preparation.paymentSourceReference),
      destinationPresent: Boolean(preparation.destinationReference),
    };

    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return {
      settlementPreparationId: preparationId,
      positionId: preparation.positionId,
      checks,
      blockers,
      readyForSettlementAuthorization: blockers.length === 0,
    };
  }

  async startReview(preparationId, input = {}, actorId = null) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Settlement preparation was not found.');
    const existing = this.domain.list(TYPES.SETTLEMENT_REVIEW).find((record) => record.settlementPreparationId === preparationId && record.status === 'IN_REVIEW');
    if (existing) return existing;

    const review = {
      settlementReviewId: input.settlementReviewId || id('FMSR'),
      settlementPreparationId: preparationId,
      positionId: preparation.positionId,
      opportunityId: preparation.opportunityId,
      assessment: this.assessPreparation(preparationId),
      status: 'IN_REVIEW',
      startedBy: actorId,
      startedAt: now(),
      decision: null,
      rationale: null,
      decidedBy: null,
      decidedAt: null,
    };

    await this.domain.put(TYPES.SETTLEMENT_REVIEW, review.settlementReviewId, review, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_REVIEW_STARTED' });
    await this.domain.put(TYPES.SETTLEMENT_PREPARATION, preparationId, { ...preparation, status: 'IN_REVIEW', settlementReviewId: review.settlementReviewId, updatedAt: now() }, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION_IN_REVIEW' });
    return review;
  }

  async decide(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error('Settlement review was not found.');
    if (review.status !== 'IN_REVIEW') throw new Error('Settlement review must be in review before a decision is recorded.');
    if (!DECISIONS.has(input?.decision)) throw new Error(`Unsupported settlement decision: ${input?.decision}`);

    const assessment = this.assessPreparation(review.settlementPreparationId);
    if (input.decision === 'AUTHORIZED' && !assessment.readyForSettlementAuthorization) {
      const error = new Error('Settlement preparation is not ready for authorization.');
      error.code = 'SETTLEMENT_REVIEW_INCOMPLETE';
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
    await this.domain.put(TYPES.SETTLEMENT_REVIEW, reviewId, updatedReview, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_REVIEW_DECIDED' });

    const preparation = this.getPreparation(review.settlementPreparationId);
    await this.domain.put(TYPES.SETTLEMENT_PREPARATION, preparation.settlementPreparationId, {
      ...preparation,
      status: input.decision === 'AUTHORIZED' ? 'AUTHORIZED' : input.decision,
      settlementStatus: input.decision === 'AUTHORIZED' ? 'AUTHORIZED' : preparation.settlementStatus,
      updatedAt: decidedAt,
    }, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION_DECIDED' });

    let authorization = null;
    if (input.decision === 'AUTHORIZED') {
      authorization = {
        settlementAuthorizationId: id('FMSA'),
        settlementReviewId: reviewId,
        settlementPreparationId: preparation.settlementPreparationId,
        positionId: preparation.positionId,
        opportunityId: preparation.opportunityId,
        participantId: preparation.participantId,
        issuerParticipantId: preparation.issuerParticipantId,
        amount: preparation.amount,
        currency: preparation.currency,
        quantity: preparation.quantity,
        transactionRouteId: preparation.transactionRouteId,
        settlementRouteId: preparation.settlementRouteId,
        paymentSourceReference: preparation.paymentSourceReference,
        destinationReference: preparation.destinationReference,
        status: 'AUTHORIZED',
        authorizedBy: actorId,
        authorizedAt: decidedAt,
        consumedAt: null,
        settlementTransactionId: null,
      };
      await this.domain.put(TYPES.SETTLEMENT_AUTHORIZATION, authorization.settlementAuthorizationId, authorization, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZED' });
    }

    return { review: updatedReview, authorization };
  }

  async settle(authorizationId, input = {}, actorId = null) {
    const authorization = this.domain.get(TYPES.SETTLEMENT_AUTHORIZATION, authorizationId);
    if (!authorization) throw new Error('Settlement authorization was not found.');
    if (authorization.status !== 'AUTHORIZED' || authorization.consumedAt) throw new Error('Settlement authorization is not available for use.');

    const preparation = this.getPreparation(authorization.settlementPreparationId);
    const position = this.domain.get(TYPES.POSITION, authorization.positionId);
    if (!preparation || !position) throw new Error('Required settlement records were not found.');
    if (position.ownershipStatus !== 'PENDING_SETTLEMENT' || position.settlementStatus !== 'NOT_STARTED') throw new Error('Position is not available for settlement.');

    const settledAt = input.settledAt || now();
    const transaction = {
      transactionId: input.transactionId || id('SRATX'),
      transactionType: 'MARKETPLACE_SETTLEMENT',
      positionId: position.positionId,
      commitmentId: position.commitmentId,
      listingId: position.listingId,
      instrumentId: position.instrumentId,
      opportunityId: position.opportunityId,
      participantId: position.participantId,
      issuerParticipantId: authorization.issuerParticipantId,
      settlementAuthorizationId: authorizationId,
      amount: authorization.amount,
      currency: authorization.currency,
      quantity: authorization.quantity,
      transactionRouteId: authorization.transactionRouteId,
      settlementRouteId: authorization.settlementRouteId,
      paymentSourceReference: authorization.paymentSourceReference,
      destinationReference: authorization.destinationReference,
      externalSettlementReference: input.externalSettlementReference || null,
      state: 'RECORDED',
      status: 'SETTLED',
      recordedBy: actorId,
      recordedAt: settledAt,
    };
    await this.domain.put(TYPES.SRA_TRANSACTION, transaction.transactionId, transaction, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_RECORDED' });

    const settledPosition = {
      ...position,
      ownershipStatus: 'RECOGNIZED',
      status: 'ACTIVE',
      settlementStatus: 'SETTLED',
      settlementAuthorizationId: authorizationId,
      settlementTransactionId: transaction.transactionId,
      settledAt,
      onChainStatus: position.onChainStatus || 'NOT_PROJECTED',
      updatedAt: settledAt,
    };
    await this.domain.put(TYPES.POSITION, position.positionId, settledPosition, { actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_SETTLED' });
    await this.domain.put(TYPES.SETTLEMENT_PREPARATION, preparation.settlementPreparationId, { ...preparation, status: 'COMPLETED', settlementStatus: 'SETTLED', settlementTransactionId: transaction.transactionId, completedAt: settledAt, updatedAt: settledAt }, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_COMPLETED' });
    await this.domain.put(TYPES.SETTLEMENT_AUTHORIZATION, authorizationId, { ...authorization, status: 'CONSUMED', consumedAt: settledAt, settlementTransactionId: transaction.transactionId }, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION_CONSUMED' });

    const opportunity = this.domain.get(TYPES.OPPORTUNITY, position.opportunityId);
    if (opportunity) {
      await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, {
        ...opportunity,
        status: 'POSITION_SETTLED',
        fundingPhase: 'OWNERSHIP_RECOGNIZED',
        updatedAt: settledAt,
        history: [...(opportunity.history || []), { from: opportunity.status, to: 'POSITION_SETTLED', at: settledAt, actorId, note: position.positionId }],
      }, { actorId, eventType: 'FUNDING_OPPORTUNITY_POSITION_SETTLED' });
    }

    await this.domain.lifecycle({
      objectType: TYPES.POSITION,
      objectId: position.positionId,
      eventType: 'FUNDING_MARKETPLACE_POSITION_OWNERSHIP_RECOGNIZED',
      actorId,
      payload: {
        settlementAuthorizationId: authorizationId,
        transactionId: transaction.transactionId,
        amount: transaction.amount,
        currency: transaction.currency,
        ownershipStatus: 'RECOGNIZED',
        onChainStatus: settledPosition.onChainStatus,
      },
    });

    return { position: settledPosition, transaction };
  }
}

export { TYPES as FUNDING_MARKETPLACE_SETTLEMENT_RECORD_TYPES };
