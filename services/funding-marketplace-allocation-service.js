import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY', PARTICIPANT: 'PARTICIPANT', MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT_WINDOW: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW', COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  ALLOCATION_REVIEW: 'FUNDING_MARKETPLACE_ALLOCATION_REVIEW', POSITION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION', LIFECYCLE_EVENT: 'LIFECYCLE_EVENT',
});
const DECISIONS = new Set(['APPROVED_FOR_ALLOCATION', 'CHANGES_REQUIRED', 'REJECTED']);
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();

export class FundingMarketplaceAllocationService {
  constructor(persistentDomain) { this.domain = persistentDomain; }
  async initialize() { await this.domain.hydrate(Object.values(TYPES)); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 11', purpose: 'COMMITMENT_CLOSING_ALLOCATION_AND_SETTLEMENT_PREPARATION', allocationReviews: this.domain.list(TYPES.ALLOCATION_REVIEW).length, positions: this.domain.list(TYPES.POSITION).length, settlementPreparations: this.domain.list(TYPES.SETTLEMENT_PREPARATION).length }; }
  getWindow(windowId) { return this.domain.get(TYPES.COMMITMENT_WINDOW, windowId); }
  getReview(reviewId) { return this.domain.get(TYPES.ALLOCATION_REVIEW, reviewId); }
  listReviews(filters = {}) { return this.domain.list(TYPES.ALLOCATION_REVIEW).filter((r) => (!filters.windowId || r.windowId === filters.windowId) && (!filters.status || r.status === filters.status)); }
  listPositions(filters = {}) { return this.domain.list(TYPES.POSITION).filter((r) => (!filters.listingId || r.listingId === filters.listingId) && (!filters.participantId || r.participantId === filters.participantId) && (!filters.status || r.status === filters.status)); }
  listSettlementPreparations(filters = {}) { return this.domain.list(TYPES.SETTLEMENT_PREPARATION).filter((r) => (!filters.positionId || r.positionId === filters.positionId) && (!filters.status || r.status === filters.status)); }

  async closeWindow(windowId, actorId = null) {
    const window = this.getWindow(windowId); if (!window) throw new Error('Commitment window was not found.'); if (window.status !== 'OPEN') throw new Error(`Commitment window cannot be closed from ${window.status}.`);
    if (this.domain.list(TYPES.COMMITMENT).some((r) => r.windowId === windowId && r.status === 'RESERVED')) throw new Error('All reserved commitments must be confirmed or cancelled before closing the window.');
    const closedAt = now(), updated = { ...window, status: 'CLOSED', closedAt };
    const listing = this.domain.get(TYPES.MARKETPLACE_LISTING, window.listingId);
    const changes = [{ type: TYPES.COMMITMENT_WINDOW, id: windowId, payload: updated, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW_CLOSED' }];
    if (listing) changes.push({ type: TYPES.MARKETPLACE_LISTING, id: listing.listingId, payload: { ...listing, commitmentsStatus: 'CLOSED', updatedAt: closedAt }, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENTS_CLOSED' });
    await this.domain.atomicPut(changes); return updated;
  }

  assessWindow(windowId) {
    const window = this.getWindow(windowId); if (!window) throw new Error('Commitment window was not found.');
    const commitments = this.domain.list(TYPES.COMMITMENT).filter((r) => r.windowId === windowId), confirmed = commitments.filter((r) => r.status === 'CONFIRMED'), reserved = commitments.filter((r) => r.status === 'RESERVED'), cancelled = commitments.filter((r) => r.status === 'CANCELLED');
    const confirmedQuantity = confirmed.reduce((sum, r) => sum + Number(r.quantity || 0), 0), confirmedAmount = confirmed.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
    const checks = { windowClosed: window.status === 'CLOSED', noReservedCommitments: reserved.length === 0, confirmedCommitmentsPresent: confirmed.length > 0, committedQuantityConsistent: confirmedQuantity === Number(window.committedQuantity), committedQuantityWithinOpeningQuantity: confirmedQuantity <= Number(window.openingQuantity) };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { windowId, listingId: window.listingId, checks, blockers, counts: { confirmed: confirmed.length, reserved: reserved.length, cancelled: cancelled.length }, totals: { confirmedQuantity, confirmedAmount, currency: window.pricingCurrency }, commitments: confirmed, readyForAllocationReview: blockers.length === 0 };
  }

  async startReview(windowId, input = {}, actorId = null) {
    const assessment = this.assessWindow(windowId); if (!assessment.readyForAllocationReview) { const error = new Error('Commitment window is not ready for allocation review.'); error.code = 'ALLOCATION_REVIEW_INCOMPLETE'; error.assessment = assessment; throw error; }
    const existing = this.domain.list(TYPES.ALLOCATION_REVIEW).find((r) => r.windowId === windowId && r.status === 'IN_REVIEW'); if (existing) return existing;
    const timestamp = now(), review = { allocationReviewId: input.allocationReviewId || id('FMAR'), windowId, listingId: assessment.listingId, assessment, status: 'IN_REVIEW', startedBy: actorId, startedAt: timestamp, decision: null, rationale: null, decidedBy: null, decidedAt: null };
    await this.domain.atomicPut([{ type: TYPES.ALLOCATION_REVIEW, id: review.allocationReviewId, payload: review, actorId, eventType: 'FUNDING_MARKETPLACE_ALLOCATION_REVIEW_STARTED' }]); return review;
  }

  async decide(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId); if (!review) throw new Error('Allocation review was not found.'); if (review.status !== 'IN_REVIEW') throw new Error('Allocation review must be in review before a decision is recorded.'); if (!DECISIONS.has(input?.decision)) throw new Error(`Unsupported allocation review decision: ${input?.decision}`);
    const assessment = this.assessWindow(review.windowId); if (input.decision === 'APPROVED_FOR_ALLOCATION' && !assessment.readyForAllocationReview) { const error = new Error('Commitment window is not ready for allocation approval.'); error.code = 'ALLOCATION_REVIEW_INCOMPLETE'; error.assessment = assessment; throw error; }
    const updated = { ...review, assessment, status: input.decision, decision: input.decision, rationale: input.rationale || null, decidedBy: actorId, decidedAt: now() };
    await this.domain.atomicPut([{ type: TYPES.ALLOCATION_REVIEW, id: reviewId, payload: updated, actorId, eventType: 'FUNDING_MARKETPLACE_ALLOCATION_REVIEW_DECIDED' }]); return updated;
  }

  async createPositions(reviewId, actorId = null) {
    const review = this.getReview(reviewId); if (!review) throw new Error('Allocation review was not found.'); if (review.decision !== 'APPROVED_FOR_ALLOCATION') throw new Error('Allocation review must be approved before positions are created.');
    const commitments = this.domain.list(TYPES.COMMITMENT).filter((r) => r.windowId === review.windowId && r.status === 'CONFIRMED');
    const created = [], changes = [], timestamp = now();
    for (const commitment of commitments) {
      const existing = this.domain.list(TYPES.POSITION).find((r) => r.commitmentId === commitment.commitmentId); if (existing) { created.push(existing); continue; }
      if (!this.domain.get(TYPES.PARTICIPANT, commitment.participantId)) throw new Error(`Participant was not found for commitment ${commitment.commitmentId}.`);
      const position = { positionId: id('FMPOS'), allocationReviewId: reviewId, commitmentId: commitment.commitmentId, windowId: commitment.windowId, listingId: commitment.listingId, instrumentId: commitment.instrumentId, opportunityId: commitment.opportunityId, participantId: commitment.participantId, quantity: commitment.quantity, unitPrice: commitment.unitPrice, totalAmount: commitment.totalAmount, currency: commitment.currency, ownershipStatus: 'PENDING_SETTLEMENT', status: 'CREATED', settlementStatus: 'NOT_STARTED', onChainStatus: 'NOT_PROJECTED', createdBy: actorId, createdAt: timestamp };
      changes.push({ type: TYPES.POSITION, id: position.positionId, payload: position, actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_CREATED' });
      changes.push({ type: TYPES.COMMITMENT, id: commitment.commitmentId, payload: { ...commitment, allocationStatus: 'ALLOCATED', positionId: position.positionId, updatedAt: timestamp }, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_ALLOCATED' });
      created.push(position);
    }
    if (changes.length) await this.domain.atomicPut(changes);
    return { records: created };
  }

  async prepareSettlement(positionId, input = {}, actorId = null) {
    const position = this.domain.get(TYPES.POSITION, positionId); if (!position) throw new Error('Marketplace position was not found.'); if (position.status !== 'CREATED' || position.settlementStatus !== 'NOT_STARTED') throw new Error('Position is not available for settlement preparation.');
    const listing = this.domain.get(TYPES.MARKETPLACE_LISTING, position.listingId); if (!listing) throw new Error('Marketplace listing was not found.');
    const existing = this.domain.list(TYPES.SETTLEMENT_PREPARATION).find((r) => r.positionId === positionId && !['CANCELLED', 'CLOSED'].includes(r.status)); if (existing) return existing;
    const timestamp = now();
    const preparation = { settlementPreparationId: input.settlementPreparationId || id('FMSP'), positionId, commitmentId: position.commitmentId, listingId: position.listingId, instrumentId: position.instrumentId, opportunityId: position.opportunityId, participantId: position.participantId, issuerParticipantId: listing.issuerParticipantId, amount: position.totalAmount, currency: position.currency, quantity: position.quantity, transactionRouteId: listing.transactionRouteId, settlementRouteId: listing.settlementRouteId, paymentSourceReference: input.paymentSourceReference || null, destinationReference: input.destinationReference || null, status: 'PREPARED', settlementStatus: 'NOT_STARTED', createdBy: actorId, createdAt: timestamp, updatedAt: timestamp };
    const updatedPosition = { ...position, status: 'SETTLEMENT_PREPARED', settlementPreparationId: preparation.settlementPreparationId };
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, position.opportunityId);
    const lifecycle = { id: id('LE'), objectType: TYPES.POSITION, objectId: positionId, eventType: 'FUNDING_MARKETPLACE_POSITION_PREPARED_FOR_SETTLEMENT', actorId, payload: { settlementPreparationId: preparation.settlementPreparationId, amount: preparation.amount, currency: preparation.currency, onChainStatus: 'NOT_PROJECTED' }, occurredAt: timestamp };
    const changes = [
      { type: TYPES.SETTLEMENT_PREPARATION, id: preparation.settlementPreparationId, payload: preparation, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARED' },
      { type: TYPES.POSITION, id: positionId, payload: updatedPosition, actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_SETTLEMENT_PREPARED' },
      { type: TYPES.LIFECYCLE_EVENT, id: lifecycle.id, payload: lifecycle, actorId, eventType: lifecycle.eventType },
    ];
    if (opportunity) changes.push({ type: TYPES.OPPORTUNITY, id: opportunity.opportunityId, payload: { ...opportunity, status: 'ALLOCATION_CREATED', fundingPhase: 'SETTLEMENT_PREPARATION', updatedAt: timestamp }, actorId, eventType: 'FUNDING_OPPORTUNITY_ALLOCATION_CREATED' });
    await this.domain.atomicPut(changes); return preparation;
  }
}

export { TYPES as FUNDING_MARKETPLACE_ALLOCATION_RECORD_TYPES };
