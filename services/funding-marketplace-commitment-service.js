import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  PARTICIPANT: 'PARTICIPANT',
  MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT_WINDOW: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  RESERVATION: 'FUNDING_MARKETPLACE_COMMITMENT_RESERVATION',
});

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export class FundingMarketplaceCommitmentService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 10',
      purpose: 'CONTROLLED_MARKETPLACE_COMMITMENTS',
      commitmentWindows: this.domain.list(TYPES.COMMITMENT_WINDOW).length,
      commitments: this.domain.list(TYPES.COMMITMENT).length,
      reservations: this.domain.list(TYPES.RESERVATION).length,
    };
  }

  getListing(listingId) {
    return this.domain.get(TYPES.MARKETPLACE_LISTING, listingId);
  }

  getWindow(windowId) {
    return this.domain.get(TYPES.COMMITMENT_WINDOW, windowId);
  }

  listWindows(filters = {}) {
    return this.domain.list(TYPES.COMMITMENT_WINDOW).filter((record) => {
      if (filters.listingId && record.listingId !== filters.listingId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  listCommitments(filters = {}) {
    return this.domain.list(TYPES.COMMITMENT).filter((record) => {
      if (filters.listingId && record.listingId !== filters.listingId) return false;
      if (filters.participantId && record.participantId !== filters.participantId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  assessListing(listingId) {
    const listing = this.getListing(listingId);
    if (!listing) throw new Error('Marketplace listing was not found.');
    const checks = {
      listingLive: listing.state === 'LIVE',
      listingActive: listing.status === 'ACTIVE',
      listingPublished: listing.publicationStatus === 'PUBLISHED',
      quantityAvailable: Number(listing.quantity) > 0,
      priceConfigured: Number(listing.pricing?.askingPrice) > 0,
      eligibilityRulePresent: Boolean(listing.access?.eligibilityRule),
      minimumOrderValid: Number(listing.access?.minimumOrder) > 0,
      transactionRouteConnected: Boolean(listing.transactionRouteId),
      settlementRouteConnected: Boolean(listing.settlementRouteId),
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { listingId, checks, blockers, readyToOpenCommitments: blockers.length === 0 };
  }

  async openWindow(listingId, input = {}, actorId = null) {
    const listing = this.getListing(listingId);
    if (!listing) throw new Error('Marketplace listing was not found.');
    const assessment = this.assessListing(listingId);
    if (!assessment.readyToOpenCommitments) {
      const error = new Error('Marketplace listing is not ready to accept commitments.');
      error.code = 'COMMITMENT_WINDOW_INCOMPLETE';
      error.assessment = assessment;
      throw error;
    }

    const existing = this.domain.list(TYPES.COMMITMENT_WINDOW).find((record) => record.listingId === listingId && record.status === 'OPEN');
    if (existing) return existing;

    const availableQuantity = Number(input.availableQuantity ?? listing.quantity);
    if (!Number.isFinite(availableQuantity) || availableQuantity <= 0 || availableQuantity > Number(listing.quantity)) {
      throw new Error('Available commitment quantity must be greater than zero and cannot exceed listing quantity.');
    }

    const window = {
      commitmentWindowId: input.commitmentWindowId || id('FMCW'),
      listingId,
      instrumentId: listing.instrumentId,
      opportunityId: listing.opportunityId,
      openingQuantity: availableQuantity,
      availableQuantity,
      reservedQuantity: 0,
      committedQuantity: 0,
      askingPrice: Number(listing.pricing.askingPrice),
      pricingCurrency: listing.pricing.currency,
      minimumOrder: Number(listing.access.minimumOrder),
      maximumOrder: listing.access.maximumOrder == null ? null : Number(listing.access.maximumOrder),
      eligibilityRule: listing.access.eligibilityRule,
      participantClasses: unique(listing.access.participantClasses || []),
      opensAt: input.opensAt || now(),
      closesAt: input.closesAt || null,
      status: 'OPEN',
      openedBy: actorId,
      openedAt: now(),
      closedAt: null,
    };

    await this.domain.put(TYPES.COMMITMENT_WINDOW, window.commitmentWindowId, window, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_OPENED' });
    await this.domain.put(TYPES.MARKETPLACE_LISTING, listingId, {
      ...listing,
      commitmentsStatus: 'OPEN',
      commitmentWindowId: window.commitmentWindowId,
      updatedAt: now(),
    }, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENTS_OPENED' });
    return window;
  }

  assessParticipant(windowId, participantId, quantity) {
    const window = this.getWindow(windowId);
    if (!window) throw new Error('Commitment window was not found.');
    const participant = this.domain.get(TYPES.PARTICIPANT, participantId);
    if (!participant) throw new Error('Participant was not found.');
    const requestedQuantity = Number(quantity);

    const checks = {
      windowOpen: window.status === 'OPEN',
      participantActive: !participant.status || ['ACTIVE', 'VERIFIED', 'ENABLED'].includes(participant.status),
      participantClassEligible: window.participantClasses.length === 0 || window.participantClasses.includes(participant.type) || window.participantClasses.includes(participant.participantClass),
      quantityValid: Number.isFinite(requestedQuantity) && requestedQuantity > 0,
      minimumOrderMet: requestedQuantity >= window.minimumOrder,
      maximumOrderMet: window.maximumOrder == null || requestedQuantity <= window.maximumOrder,
      quantityAvailable: requestedQuantity <= window.availableQuantity,
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { windowId, participantId, requestedQuantity, checks, blockers, eligible: blockers.length === 0 };
  }

  async createCommitment(windowId, input, actorId = null) {
    const window = this.getWindow(windowId);
    if (!window) throw new Error('Commitment window was not found.');
    if (!input?.participantId) throw new Error('participantId is required.');

    const assessment = this.assessParticipant(windowId, input.participantId, input.quantity);
    if (!assessment.eligible) {
      const error = new Error('Participant commitment is not eligible.');
      error.code = 'COMMITMENT_INELIGIBLE';
      error.assessment = assessment;
      throw error;
    }

    const existingActive = this.domain.list(TYPES.COMMITMENT).find((record) => record.windowId === windowId && record.participantId === input.participantId && ['RESERVED', 'CONFIRMED'].includes(record.status));
    if (existingActive) throw new Error('Participant already has an active commitment in this window.');

    const quantity = assessment.requestedQuantity;
    const totalAmount = quantity * Number(window.askingPrice);
    const commitment = {
      commitmentId: input.commitmentId || id('FMC'),
      windowId,
      listingId: window.listingId,
      instrumentId: window.instrumentId,
      opportunityId: window.opportunityId,
      participantId: input.participantId,
      quantity,
      unitPrice: window.askingPrice,
      totalAmount,
      currency: window.pricingCurrency,
      eligibilityAssessment: assessment,
      status: 'RESERVED',
      submittedBy: actorId || input.participantId,
      submittedAt: now(),
      expiresAt: input.expiresAt || null,
      confirmedAt: null,
      cancelledAt: null,
      settlementStatus: 'NOT_STARTED',
      allocationStatus: 'NOT_ALLOCATED',
    };

    const reservation = {
      reservationId: id('FMCR'),
      commitmentId: commitment.commitmentId,
      windowId,
      listingId: window.listingId,
      participantId: input.participantId,
      quantity,
      status: 'ACTIVE',
      reservedAt: now(),
      releasedAt: null,
    };

    await this.domain.put(TYPES.COMMITMENT, commitment.commitmentId, commitment, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_RECORDED' });
    await this.domain.put(TYPES.RESERVATION, reservation.reservationId, reservation, { actorId, eventType: 'FUNDING_MARKETPLACE_QUANTITY_RESERVED' });
    await this.domain.put(TYPES.COMMITMENT_WINDOW, windowId, {
      ...window,
      availableQuantity: window.availableQuantity - quantity,
      reservedQuantity: window.reservedQuantity + quantity,
    }, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_UPDATED' });

    await this.domain.lifecycle({
      objectType: TYPES.COMMITMENT,
      objectId: commitment.commitmentId,
      eventType: 'FUNDING_MARKETPLACE_COMMITMENT_RESERVED',
      actorId,
      payload: { listingId: commitment.listingId, participantId: commitment.participantId, quantity, settlementStatus: commitment.settlementStatus },
    });
    return { commitment, reservation };
  }

  async confirmCommitment(commitmentId, actorId = null) {
    const commitment = this.domain.get(TYPES.COMMITMENT, commitmentId);
    if (!commitment) throw new Error('Commitment was not found.');
    if (commitment.status !== 'RESERVED') throw new Error(`Commitment cannot be confirmed from ${commitment.status}.`);

    const confirmedAt = now();
    const updated = { ...commitment, status: 'CONFIRMED', confirmedAt };
    await this.domain.put(TYPES.COMMITMENT, commitmentId, updated, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_CONFIRMED' });

    const window = this.getWindow(commitment.windowId);
    await this.domain.put(TYPES.COMMITMENT_WINDOW, window.commitmentWindowId, {
      ...window,
      reservedQuantity: window.reservedQuantity - commitment.quantity,
      committedQuantity: window.committedQuantity + commitment.quantity,
    }, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_CONFIRMED' });
    return updated;
  }

  async cancelCommitment(commitmentId, reason = null, actorId = null) {
    const commitment = this.domain.get(TYPES.COMMITMENT, commitmentId);
    if (!commitment) throw new Error('Commitment was not found.');
    if (!['RESERVED', 'CONFIRMED'].includes(commitment.status)) throw new Error(`Commitment cannot be cancelled from ${commitment.status}.`);

    const cancelledAt = now();
    const updated = { ...commitment, status: 'CANCELLED', cancellationReason: reason, cancelledAt };
    await this.domain.put(TYPES.COMMITMENT, commitmentId, updated, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_CANCELLED' });

    const window = this.getWindow(commitment.windowId);
    const wasReserved = commitment.status === 'RESERVED';
    await this.domain.put(TYPES.COMMITMENT_WINDOW, window.commitmentWindowId, {
      ...window,
      availableQuantity: window.availableQuantity + commitment.quantity,
      reservedQuantity: Math.max(0, window.reservedQuantity - (wasReserved ? commitment.quantity : 0)),
      committedQuantity: Math.max(0, window.committedQuantity - (wasReserved ? 0 : commitment.quantity)),
    }, { actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_RELEASED' });
    return updated;
  }
}

export { TYPES as FUNDING_MARKETPLACE_COMMITMENT_RECORD_TYPES };
