import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  PARTICIPANT: 'PARTICIPANT',
  MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT_WINDOW: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  ALLOCATION_REVIEW: 'FUNDING_MARKETPLACE_ALLOCATION_REVIEW',
  POSITION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION',
});

const DECISIONS = new Set(['APPROVED_FOR_ALLOCATION', 'CHANGES_REQUIRED', 'REJECTED']);

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

export class FundingMarketplaceAllocationService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 11',
      purpose: 'COMMITMENT_CLOSING_ALLOCATION_AND_SETTLEMENT_PREPARATION',
      allocationReviews: this.domain.list(TYPES.ALLOCATION_REVIEW).length,
      positions: this.domain.list(TYPES.POSITION).length,
      settlementPreparations: this.domain.list(TYPES.SETTLEMENT_PREPARATION).length,
    };
  }

  getWindow(windowId) {
    return this.domain.get(TYPES.COMMITMENT_WINDOW, windowId);
  }

  getReview(reviewId) {
    return this.domain.get(TYPES.ALLOCATION_REVIEW, reviewId);
  }

  listReviews(filters = {}) {
    return this.domain.list(TYPES.ALLOCATION_REVIEW).filter((record) => {
      if (filters.windowId && record.windowId !== filters.windowId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  listPositions(filters = {}) {
    return this.domain.list(TYPES.POSITION).filter((record) => {
      if (filters.listingId && record.listingId !== filters.listingId) return false;
      if (filters.participantId && record.participantId !== filters.participantId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  listSettlementPreparations(filters = {}) {
    return this.domain.list(TYPES.SETTLEMENT_PREPARATION).filter((record) => {
      if (filters.positionId && record.positionId !== filters.positionId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  async closeWindow(windowId, actorId = null) {
    const window = this.getWindow(windowId);
    if (!window) throw new Error('Commitment window was not found.');
    if (window.status !== 'OPEN') throw new Error(`Commitment window cannot be closed from ${window.status}.`);

    const reserved = this.domain.list(TYPES.COMMITMENT).filter((record) => record.windowId === windowId && record.status === 'RESERVED');
    if (reserved.length > 0) throw new Error('All reserved commitments must be confirmed or cancelled before closing the window.');

    const closedAt = now();
    const updated = { ...window, status: 'CLOSED', closedAt };
    await this.domain.put(TYPES.COMMITMENT_WINDOW, windowId, updated, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_CLOSED' });

    const listing = this.domain.get(TYPES.MARKETPLACE_LISTING, window.listingId);
    if (listing) {
      await this.domain.put(TYPES.MARKETPLACE_LISTING, listing.listingId, { ...listing, commitmentsStatus: 'CLOSED', updatedAt: closedAt }, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENTS_CLOSED' });
    }
    return updated;
  }

  assessWindow(windowId) {
    const window = this.getWindow(windowId);
    if (!window) throw new Error('Commitment window was not found.');
    const commitments = this.domain.list(TYPES.COMMITMENT).filter((record) => record.windowId === windowId);
    const confirmed = commitments.filter((record) => record.status === 'CONFIRMED');
    const reserved = commitments.filter((record) => record.status === 'RESERVED');
    const cancelled = commitments.filter((record) => record.status === 'CANCELLED');
    const confirmedQuantity = confirmed.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
    const confirmedAmount = confirmed.reduce((sum, record) => sum + Number(record.totalAmount || 0), 0);

    const checks = {
      windowClosed: window.status === 'CLOSED',
      noReservedCommitments: reserved.length === 0,
      confirmedCommitmentsPresent: confirmed.length > 0,
      committedQuantityConsistent: confirmedQuantity === Number(window.committedQuantity),
      committedQuantityWithinOpeningQuantity: confirmedQuantity <= Number(window.openingQuantity),
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);

    return {
      windowId,
      listingId: window.listingId,
      checks,
      blockers,
      counts: { confirmed: confirmed.length, reserved: reserved.length, cancelled: cancelled.length },
      totals: { confirmedQuantity, confirmedAmount, currency: window.pricingCurrency },
      commitments: confirmed,
      readyForAllocationReview: blockers.length === 0,
    };
  }

  async startReview(windowId, input = {}, actorId = null) {
    const assessment = this.assessWindow(windowId);
    if (!assessment.readyForAllocationReview) {
      const error = new Error('Commitment window is not ready for allocation review.');
      error.code = 'ALLOCATION_REVIEW_INCOMPLETE';
      error.assessment = assessment;
      throw error;
    }

    const existing = this.domain.list(TYPES.ALLOCATION_REVIEW).find((record) => record.windowId === windowId && record.status === 'IN_REVIEW');
    if (existing) return existing;

    const review = {
      allocationReviewId: input.allocationReviewId || id('FMAR'),
      windowId,
      listingId: assessment.listingId,
      assessment,
      status: 'IN_REVIEW',
      startedBy: actorId,
      startedAt: now(),
      decision: null,
      rationale: null,
      decidedBy: null,
      decidedAt: null,
    };
    await this.domain.put(TYPES.ALLOCATION_REVIEW, review.allocationReviewId, review, { actorId, eventType: 'FUNDING_MARKETPLACE_ALLOCATION_REVIEW_STARTED' });
    return review;
  }

  async decide(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error('Allocation review was not found.');
    if (review.status !== 'IN_REVIEW') throw new Error('Allocation review must be in review before a decision is recorded.');
    if (!DECISIONS.has(input?.decision)) throw new Error(`Unsupported allocation review decision: ${input?.decision}`);

    const assessment = this.assessWindow(review.windowId);
    if (input.decision === 'APPROVED_FOR_ALLOCATION' && !assessment.readyForAllocationReview) {
      const error = new Error('Commitment window is not ready for allocation approval.');
      error.code = 'ALLOCATION_REVIEW_INCOMPLETE';
      error.assessment = assessment;
      throw error;
    }

    const decidedAt = now();
    const updated = {
      ...review,
      assessment,
      status: input.decision,
      decision: input.decision,
      rationale: input.rationale || null,
      decidedBy: actorId,
      decidedAt,
    };
    await this.domain.put(TYPES.ALLOCATION_REVIEW, reviewId, updated, { actorId, eventType: 'FUNDING_MARKETPLACE_ALLOCATION_REVIEW_DECIDED' });
    return updated;
  }

  async createPositions(reviewId, actorId = null) {
    const review = this.getReview(reviewId);
    if (!review) throw new Error('Allocation review was not found.');
    if (review.decision !== 'APPROVED_FOR_ALLOCATION') throw new Error('Allocation review must be approved before positions are created.');

    const commitments = this.domain.list(TYPES.COMMITMENT).filter((record) => record.windowId === review.windowId && record.status === 'CONFIRMED');
    const created = [];

    for (const commitment of commitments) {
      const existing = this.domain.list(TYPES.POSITION).find((record) => record.commitmentId === commitment.commitmentId);
      if (existing) {
        created.push(existing);
        continue;
      }

      const participant = this.domain.get(TYPES.PARTICIPANT, commitment.participantId);
      if (!participant) throw new Error(`Participant was not found for commitment ${commitment.commitmentId}.`);

      const position = {
        positionId: id('FMPOS'),
        allocationReviewId: reviewId,
        commitmentId: commitment.commitmentId,
        windowId: commitment.windowId,
        listingId: commitment.listingId,
        instrumentId: commitment.instrumentId,
        opportunityId: commitment.opportunityId,
        participantId: commitment.participantId,
        quantity: commitment.quantity,
        unitPrice: commitment.unitPrice,
        totalAmount: commitment.totalAmount,
        currency: commitment.currency,
        ownershipStatus: 'PENDING_SETTLEMENT',
        status: 'CREATED',
        settlementStatus: 'NOT_STARTED',
        onChainStatus: 'NOT_PROJECTED',
        createdBy: actorId,
        createdAt: now(),
      };
      await this.domain.put(TYPES.POSITION, position.positionId, position, { actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_CREATED' });
      await this.domain.put(TYPES.COMMITMENT, commitment.commitmentId, { ...commitment, allocationStatus: 'ALLOCATED', positionId: position.positionId, updatedAt: now() }, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_ALLOCATED' });
      created.push(position);
    }

    return { records: created };
  }

  async prepareSettlement(positionId, input = {}, actorId = null) {
    const position = this.domain.get(TYPES.POSITION, positionId);
    if (!position) throw new Error('Marketplace position was not found.');
    if (position.status !== 'CREATED' || position.settlementStatus !== 'NOT_STARTED') throw new Error('Position is not available for settlement preparation.');

    const listing = this.domain.get(TYPES.MARKETPLACE_LISTING, position.listingId);
    if (!listing) throw new Error('Marketplace listing was not found.');

    const existing = this.domain.list(TYPES.SETTLEMENT_PREPARATION).find((record) => record.positionId === positionId && !['CANCELLED', 'CLOSED'].includes(record.status));
    if (existing) return existing;

    const preparation = {
      settlementPreparationId: input.settlementPreparationId || id('FMSP'),
      positionId,
      commitmentId: position.commitmentId,
      listingId: position.listingId,
      instrumentId: position.instrumentId,
      opportunityId: position.opportunityId,
      participantId: position.participantId,
      issuerParticipantId: listing.issuerParticipantId,
      amount: position.totalAmount,
      currency: position.currency,
      quantity: position.quantity,
      transactionRouteId: listing.transactionRouteId,
      settlementRouteId: listing.settlementRouteId,
      paymentSourceReference: input.paymentSourceReference || null,
      destinationReference: input.destinationReference || null,
      status: 'PREPARED',
      settlementStatus: 'NOT_STARTED',
      createdBy: actorId,
      createdAt: now(),
      updatedAt: now(),
    };

    await this.domain.put(TYPES.SETTLEMENT_PREPARATION, preparation.settlementPreparationId, preparation, { actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARED' });
    await this.domain.put(TYPES.POSITION, positionId, { ...position, status: 'SETTLEMENT_PREPARED', settlementPreparationId: preparation.settlementPreparationId }, { actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_SETTLEMENT_PREPARED' });

    const opportunity = this.domain.get(TYPES.OPPORTUNITY, position.opportunityId);
    if (opportunity) {
      await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, {
        ...opportunity,
        status: 'ALLOCATION_CREATED',
        fundingPhase: 'SETTLEMENT_PREPARATION',
        updatedAt: now(),
      }, { actorId, eventType: 'FUNDING_OPPORTUNITY_ALLOCATION_CREATED' });
    }

    await this.domain.lifecycle({
      objectType: TYPES.POSITION,
      objectId: positionId,
      eventType: 'FUNDING_MARKETPLACE_POSITION_PREPARED_FOR_SETTLEMENT',
      actorId,
      payload: { settlementPreparationId: preparation.settlementPreparationId, amount: preparation.amount, currency: preparation.currency, onChainStatus: 'NOT_PROJECTED' },
    });
    return preparation;
  }
}

export { TYPES as FUNDING_MARKETPLACE_ALLOCATION_RECORD_TYPES };
