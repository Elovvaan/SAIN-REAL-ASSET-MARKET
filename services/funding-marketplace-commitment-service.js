import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY', PARTICIPANT: 'PARTICIPANT', MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT_WINDOW: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW', COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  RESERVATION: 'FUNDING_MARKETPLACE_COMMITMENT_RESERVATION', LIFECYCLE_EVENT: 'LIFECYCLE_EVENT',
});
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();
const unique = (values = []) => [...new Set(values.filter(Boolean))];

export class FundingMarketplaceCommitmentService {
  constructor(persistentDomain) { this.domain = persistentDomain; }
  async initialize() { await this.domain.hydrate(Object.values(TYPES)); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 10', purpose: 'CONTROLLED_MARKETPLACE_COMMITMENTS', commitmentWindows: this.domain.list(TYPES.COMMITMENT_WINDOW).length, commitments: this.domain.list(TYPES.COMMITMENT).length, reservations: this.domain.list(TYPES.RESERVATION).length }; }
  getListing(listingId) { return this.domain.get(TYPES.MARKETPLACE_LISTING, listingId); }
  getWindow(windowId) { return this.domain.get(TYPES.COMMITMENT_WINDOW, windowId); }
  listWindows(filters = {}) { return this.domain.list(TYPES.COMMITMENT_WINDOW).filter((r) => (!filters.listingId || r.listingId === filters.listingId) && (!filters.status || r.status === filters.status)); }
  listCommitments(filters = {}) { return this.domain.list(TYPES.COMMITMENT).filter((r) => (!filters.listingId || r.listingId === filters.listingId) && (!filters.participantId || r.participantId === filters.participantId) && (!filters.status || r.status === filters.status)); }

  assessListing(listingId) {
    const listing = this.getListing(listingId); if (!listing) throw new Error('Marketplace listing was not found.');
    const checks = { listingLive: listing.state === 'LIVE', listingActive: listing.status === 'ACTIVE', listingPublished: listing.publicationStatus === 'PUBLISHED', quantityAvailable: Number(listing.quantity) > 0, priceConfigured: Number(listing.pricing?.askingPrice) > 0, eligibilityRulePresent: Boolean(listing.access?.eligibilityRule), minimumOrderValid: Number(listing.access?.minimumOrder) > 0, transactionRouteConnected: Boolean(listing.transactionRouteId), settlementRouteConnected: Boolean(listing.settlementRouteId) };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { listingId, checks, blockers, readyToOpenCommitments: blockers.length === 0 };
  }

  async openWindow(listingId, input = {}, actorId = null) {
    const listing = this.getListing(listingId); if (!listing) throw new Error('Marketplace listing was not found.');
    const assessment = this.assessListing(listingId); if (!assessment.readyToOpenCommitments) { const error = new Error('Marketplace listing is not ready to accept commitments.'); error.code = 'COMMITMENT_WINDOW_INCOMPLETE'; error.assessment = assessment; throw error; }
    const existing = this.domain.list(TYPES.COMMITMENT_WINDOW).find((r) => r.listingId === listingId && r.status === 'OPEN'); if (existing) return existing;
    const availableQuantity = Number(input.availableQuantity ?? listing.quantity); if (!Number.isFinite(availableQuantity) || availableQuantity <= 0 || availableQuantity > Number(listing.quantity)) throw new Error('Available commitment quantity must be greater than zero and cannot exceed listing quantity.');
    const timestamp = now();
    const window = { commitmentWindowId: input.commitmentWindowId || id('FMCW'), listingId, instrumentId: listing.instrumentId, opportunityId: listing.opportunityId, openingQuantity: availableQuantity, availableQuantity, reservedQuantity: 0, committedQuantity: 0, askingPrice: Number(listing.pricing.askingPrice), pricingCurrency: listing.pricing.currency, minimumOrder: Number(listing.access.minimumOrder), maximumOrder: listing.access.maximumOrder == null ? null : Number(listing.access.maximumOrder), eligibilityRule: listing.access.eligibilityRule, participantClasses: unique(listing.access.participantClasses || []), opensAt: input.opensAt || timestamp, closesAt: input.closesAt || null, status: 'OPEN', openedBy: actorId, openedAt: timestamp, closedAt: null };
    await this.domain.atomicPut([
      { type: TYPES.COMMITMENT_WINDOW, id: window.commitmentWindowId, payload: window, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_OPENED' },
      { type: TYPES.MARKETPLACE_LISTING, id: listingId, payload: { ...listing, commitmentsStatus: 'OPEN', commitmentWindowId: window.commitmentWindowId, updatedAt: timestamp }, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENTS_OPENED' },
    ]);
    return window;
  }

  assessParticipant(windowId, participantId, quantity) {
    const window = this.getWindow(windowId); if (!window) throw new Error('Commitment window was not found.');
    const participant = this.domain.get(TYPES.PARTICIPANT, participantId); if (!participant) throw new Error('Participant was not found.');
    const requestedQuantity = Number(quantity);
    const checks = { windowOpen: window.status === 'OPEN', participantActive: !participant.status || ['ACTIVE', 'VERIFIED', 'ENABLED'].includes(participant.status), participantClassEligible: window.participantClasses.length === 0 || window.participantClasses.includes(participant.type) || window.participantClasses.includes(participant.participantClass), quantityValid: Number.isFinite(requestedQuantity) && requestedQuantity > 0, minimumOrderMet: requestedQuantity >= window.minimumOrder, maximumOrderMet: window.maximumOrder == null || requestedQuantity <= window.maximumOrder, quantityAvailable: requestedQuantity <= window.availableQuantity };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { windowId, participantId, requestedQuantity, checks, blockers, eligible: blockers.length === 0 };
  }

  async createCommitment(windowId, input, actorId = null) {
    const window = this.getWindow(windowId); if (!window) throw new Error('Commitment window was not found.'); if (!input?.participantId) throw new Error('participantId is required.');
    const assessment = this.assessParticipant(windowId, input.participantId, input.quantity); if (!assessment.eligible) { const error = new Error('Participant commitment is not eligible.'); error.code = 'COMMITMENT_INELIGIBLE'; error.assessment = assessment; throw error; }
    if (this.domain.list(TYPES.COMMITMENT).some((r) => r.windowId === windowId && r.participantId === input.participantId && ['RESERVED', 'CONFIRMED'].includes(r.status))) throw new Error('Participant already has an active commitment in this window.');
    const timestamp = now(), quantity = assessment.requestedQuantity;
    const commitment = { commitmentId: input.commitmentId || id('FMC'), windowId, listingId: window.listingId, instrumentId: window.instrumentId, opportunityId: window.opportunityId, participantId: input.participantId, quantity, unitPrice: window.askingPrice, totalAmount: quantity * Number(window.askingPrice), currency: window.pricingCurrency, eligibilityAssessment: assessment, status: 'RESERVED', submittedBy: actorId || input.participantId, submittedAt: timestamp, expiresAt: input.expiresAt || null, confirmedAt: null, cancelledAt: null, settlementStatus: 'NOT_STARTED', allocationStatus: 'NOT_ALLOCATED' };
    const reservation = { reservationId: id('FMCR'), commitmentId: commitment.commitmentId, windowId, listingId: window.listingId, participantId: input.participantId, quantity, status: 'ACTIVE', reservedAt: timestamp, releasedAt: null };
    const lifecycle = { id: id('LE'), objectType: TYPES.COMMITMENT, objectId: commitment.commitmentId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_RESERVED', actorId, payload: { listingId: commitment.listingId, participantId: commitment.participantId, quantity, settlementStatus: commitment.settlementStatus }, occurredAt: timestamp };
    await this.domain.atomicPut([
      { type: TYPES.COMMITMENT, id: commitment.commitmentId, payload: commitment, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_RECORDED' },
      { type: TYPES.RESERVATION, id: reservation.reservationId, payload: reservation, actorId, eventType: 'FUNDING_MARKETPLACE_QUANTITY_RESERVED' },
      { type: TYPES.COMMITMENT_WINDOW, id: windowId, payload: { ...window, availableQuantity: window.availableQuantity - quantity, reservedQuantity: window.reservedQuantity + quantity }, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_UPDATED' },
      { type: TYPES.LIFECYCLE_EVENT, id: lifecycle.id, payload: lifecycle, actorId, eventType: lifecycle.eventType },
    ]);
    return { commitment, reservation };
  }

  async confirmCommitment(commitmentId, actorId = null) {
    const commitment = this.domain.get(TYPES.COMMITMENT, commitmentId); if (!commitment) throw new Error('Commitment was not found.'); if (commitment.status !== 'RESERVED') throw new Error(`Commitment cannot be confirmed from ${commitment.status}.`);
    const window = this.getWindow(commitment.windowId); if (!window) throw new Error('Commitment window was not found.');
    const confirmedAt = now();
    const updated = { ...commitment, status: 'CONFIRMED', confirmedAt };
    const updatedWindow = { ...window, reservedQuantity: Math.max(0, window.reservedQuantity - commitment.quantity), committedQuantity: window.committedQuantity + commitment.quantity };
    await this.domain.atomicPut([
      { type: TYPES.COMMITMENT, id: commitmentId, payload: updated, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_CONFIRMED' },
      { type: TYPES.COMMITMENT_WINDOW, id: window.commitmentWindowId, payload: updatedWindow, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_CONFIRMED' },
    ]);
    return updated;
  }

  async cancelCommitment(commitmentId, reason = null, actorId = null) {
    const commitment = this.domain.get(TYPES.COMMITMENT, commitmentId); if (!commitment) throw new Error('Commitment was not found.'); if (!['RESERVED', 'CONFIRMED'].includes(commitment.status)) throw new Error(`Commitment cannot be cancelled from ${commitment.status}.`);
    const window = this.getWindow(commitment.windowId); if (!window) throw new Error('Commitment window was not found.');
    const cancelledAt = now(), wasReserved = commitment.status === 'RESERVED';
    const updated = { ...commitment, status: 'CANCELLED', cancellationReason: reason, cancelledAt };
    await this.domain.atomicPut([
      { type: TYPES.COMMITMENT, id: commitmentId, payload: updated, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_CANCELLED' },
      { type: TYPES.COMMITMENT_WINDOW, id: window.commitmentWindowId, payload: { ...window, availableQuantity: window.availableQuantity + commitment.quantity, reservedQuantity: Math.max(0, window.reservedQuantity - (wasReserved ? commitment.quantity : 0)), committedQuantity: Math.max(0, window.committedQuantity - (wasReserved ? 0 : commitment.quantity)) }, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_RELEASED' },
    ]);
    return updated;
  }
}

export { TYPES as FUNDING_MARKETPLACE_COMMITMENT_RECORD_TYPES };
