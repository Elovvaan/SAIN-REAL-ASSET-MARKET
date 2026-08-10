import crypto from 'node:crypto';

const TYPES = Object.freeze({
  PARTICIPANT: 'PARTICIPANT', MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT_WINDOW: 'FUNDING_MARKETPLACE_COMMITMENT_WINDOW', COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  ALLOCATION_REVIEW: 'FUNDING_MARKETPLACE_ALLOCATION_REVIEW', POSITION: 'FUNDING_MARKETPLACE_POSITION',
  PARTICIPATION_AGREEMENT: 'SRA_SECONDARY_PARTICIPATION_AGREEMENT',
  SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION', LIFECYCLE_EVENT: 'LIFECYCLE_EVENT',
});
const DECISIONS = new Set(['APPROVED_FOR_ALLOCATION', 'CHANGES_REQUIRED', 'REJECTED']);
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();

export class FundingMarketplaceAllocationService {
  constructor(persistentDomain) { this.domain = persistentDomain; }
  async initialize() { await this.domain.hydrate(Object.values(TYPES)); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 11', purpose: 'POSITION_DISTRIBUTION_ALLOCATION_AGREEMENT_AND_SETTLEMENT_PREPARATION', allocationReviews: this.domain.list(TYPES.ALLOCATION_REVIEW).length, positions: this.domain.list(TYPES.POSITION).length, participationAgreements: this.domain.list(TYPES.PARTICIPATION_AGREEMENT).length, executedParticipationAgreements: this.domain.list(TYPES.PARTICIPATION_AGREEMENT).filter((r) => r.status === 'EXECUTED').length, settlementPreparations: this.domain.list(TYPES.SETTLEMENT_PREPARATION).length }; }
  getWindow(windowId) { return this.domain.get(TYPES.COMMITMENT_WINDOW, windowId); }
  getReview(reviewId) { return this.domain.get(TYPES.ALLOCATION_REVIEW, reviewId); }
  getAgreement(agreementId) { return this.domain.get(TYPES.PARTICIPATION_AGREEMENT, agreementId); }
  listReviews(filters = {}) { return this.domain.list(TYPES.ALLOCATION_REVIEW).filter((r) => (!filters.windowId || r.windowId === filters.windowId) && (!filters.status || r.status === filters.status)); }
  listPositions(filters = {}) { return this.domain.list(TYPES.POSITION).filter((r) => (!filters.listingId || r.listingId === filters.listingId) && (!filters.participantId || r.participantId === filters.participantId) && (!filters.status || r.status === filters.status)); }
  listAgreements(filters = {}) { return this.domain.list(TYPES.PARTICIPATION_AGREEMENT).filter((r) => (!filters.positionId || r.positionId === filters.positionId) && (!filters.financedPositionId || r.financedPositionId === filters.financedPositionId) && (!filters.participantId || r.participantId === filters.participantId) && (!filters.status || r.status === filters.status)); }
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
      const listing = this.domain.get(TYPES.MARKETPLACE_LISTING, commitment.listingId); if (!listing) throw new Error(`Marketplace listing was not found for commitment ${commitment.commitmentId}.`);
      if (!listing.positionId) throw new Error('Marketplace listing is not linked to a funded position.');
      const position = { positionId: id('FMPOS'), financedPositionId: listing.positionId, distributionAuthorizationId: listing.distributionAuthorizationId || null, allocationReviewId: reviewId, commitmentId: commitment.commitmentId, windowId: commitment.windowId, listingId: commitment.listingId, instrumentId: commitment.instrumentId, opportunityId: commitment.opportunityId, participantId: commitment.participantId, quantity: commitment.quantity, unitPrice: commitment.unitPrice, totalAmount: commitment.totalAmount, currency: commitment.currency, ownershipStatus: 'PENDING_SETTLEMENT', status: 'CREATED', settlementStatus: 'NOT_STARTED', participationAgreementId: null, onChainStatus: 'NOT_PROJECTED', createdBy: actorId, createdAt: timestamp };
      changes.push({ type: TYPES.POSITION, id: position.positionId, payload: position, actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_CREATED' });
      changes.push({ type: TYPES.COMMITMENT, id: commitment.commitmentId, payload: { ...commitment, allocationStatus: 'ALLOCATED', positionId: position.positionId, financedPositionId: listing.positionId, updatedAt: timestamp }, actorId, eventType: 'FUNDING_MARKETPLACE_COMMITMENT_ALLOCATED' });
      created.push(position);
    }
    if (changes.length) await this.domain.atomicPut(changes);
    return { records: created };
  }

  async createParticipationAgreement(positionId, input = {}, actorId = null) {
    const position = this.domain.get(TYPES.POSITION, positionId); if (!position) throw new Error('Marketplace position was not found.');
    if (position.ownershipStatus !== 'PENDING_SETTLEMENT' || !['CREATED', 'AGREEMENT_PENDING', 'AGREEMENT_EXECUTED'].includes(position.status)) throw new Error('Marketplace position is not available for a secondary participation agreement.');
    const participant = this.domain.get(TYPES.PARTICIPANT, position.participantId); if (!participant) throw new Error('Participant was not found.');
    const listing = this.domain.get(TYPES.MARKETPLACE_LISTING, position.listingId); if (!listing) throw new Error('Marketplace listing was not found.');
    const existing = this.domain.list(TYPES.PARTICIPATION_AGREEMENT).find((r) => r.positionId === positionId && !['CANCELLED', 'SUPERSEDED'].includes(r.status)); if (existing) return existing;
    const timestamp = now();
    const agreement = {
      participationAgreementId: input.participationAgreementId || id('SPA'),
      agreementType: 'SRA_SECONDARY_PARTICIPATION_AGREEMENT',
      positionId,
      financedPositionId: position.financedPositionId,
      distributionAuthorizationId: position.distributionAuthorizationId || null,
      allocationReviewId: position.allocationReviewId,
      commitmentId: position.commitmentId,
      listingId: position.listingId,
      instrumentId: position.instrumentId,
      opportunityId: position.opportunityId,
      transferorId: 'SRA',
      participantId: position.participantId,
      servicerId: 'SRA',
      participationQuantity: position.quantity,
      purchaseAmount: position.totalAmount,
      currency: position.currency,
      economicInterest: input.economicInterest || 'PRO_RATA_CONTRACTUAL_INTEREST_IN_THE_ALLOCATED_POSITION',
      servicingStandard: input.servicingStandard || 'SRA_RETAINS_SERVICING_UNLESS_SEPARATELY_TRANSFERRED',
      transferRestrictions: Array.isArray(input.transferRestrictions) ? input.transferRestrictions : (listing.restrictions || []),
      disclosures: Array.isArray(input.disclosures) ? input.disclosures : (listing.disclosures || []),
      guarantyStatus: 'NO_SRA_OR_GOVERNMENT_REPAYMENT_GUARANTY',
      creditEnhancement: 'NONE_UNLESS_SEPARATELY_DOCUMENTED',
      underlyingObligationUnchanged: true,
      financingDependency: 'NONE',
      participantAcceptanceStatus: 'PENDING',
      participantAcceptedBy: null,
      participantAcceptedAt: null,
      sraExecutionStatus: 'PENDING',
      executedBy: null,
      executedAt: null,
      status: 'DRAFT',
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.domain.atomicPut([
      { type: TYPES.PARTICIPATION_AGREEMENT, id: agreement.participationAgreementId, payload: agreement, actorId, eventType: 'SRA_SECONDARY_PARTICIPATION_AGREEMENT_CREATED' },
      { type: TYPES.POSITION, id: positionId, payload: { ...position, participationAgreementId: agreement.participationAgreementId, status: 'AGREEMENT_PENDING', updatedAt: timestamp }, actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_AGREEMENT_PENDING' },
    ]);
    return agreement;
  }

  async acceptParticipationAgreement(agreementId, input = {}, actorId = null) {
    const agreement = this.getAgreement(agreementId); if (!agreement) throw new Error('Secondary participation agreement was not found.');
    if (!['DRAFT', 'AWAITING_SRA_EXECUTION'].includes(agreement.status)) throw new Error('Secondary participation agreement is not awaiting participant acceptance.');
    if (input.accepted !== true) throw new Error('accepted must be true to record participant acceptance.');
    const acceptedAt = now();
    const updated = { ...agreement, participantAcceptanceStatus: 'ACCEPTED', participantAcceptedBy: actorId, participantAcceptedAt: acceptedAt, status: 'AWAITING_SRA_EXECUTION', updatedAt: acceptedAt };
    await this.domain.put(TYPES.PARTICIPATION_AGREEMENT, agreementId, updated, { actorId, eventType: 'SRA_SECONDARY_PARTICIPATION_AGREEMENT_ACCEPTED' });
    return updated;
  }

  async executeParticipationAgreement(agreementId, input = {}, actorId = null) {
    const agreement = this.getAgreement(agreementId); if (!agreement) throw new Error('Secondary participation agreement was not found.');
    if (agreement.participantAcceptanceStatus !== 'ACCEPTED' || agreement.status !== 'AWAITING_SRA_EXECUTION') throw new Error('Participant acceptance is required before SRA execution.');
    if (input.executed !== true) throw new Error('executed must be true to execute the agreement.');
    const position = this.domain.get(TYPES.POSITION, agreement.positionId); if (!position) throw new Error('Marketplace position was not found.');
    const executedAt = now();
    const updated = { ...agreement, sraExecutionStatus: 'EXECUTED', executedBy: actorId, executedAt, status: 'EXECUTED', updatedAt: executedAt };
    await this.domain.atomicPut([
      { type: TYPES.PARTICIPATION_AGREEMENT, id: agreementId, payload: updated, actorId, eventType: 'SRA_SECONDARY_PARTICIPATION_AGREEMENT_EXECUTED' },
      { type: TYPES.POSITION, id: position.positionId, payload: { ...position, participationAgreementId: agreementId, status: 'AGREEMENT_EXECUTED', updatedAt: executedAt }, actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_AGREEMENT_EXECUTED' },
    ]);
    return updated;
  }

  async prepareSettlement(positionId, input = {}, actorId = null) {
    const position = this.domain.get(TYPES.POSITION, positionId); if (!position) throw new Error('Marketplace position was not found.'); if (position.status !== 'AGREEMENT_EXECUTED' || position.settlementStatus !== 'NOT_STARTED') throw new Error('An executed secondary participation agreement is required before settlement preparation.');
    const listing = this.domain.get(TYPES.MARKETPLACE_LISTING, position.listingId); if (!listing) throw new Error('Marketplace listing was not found.');
    const participationAgreementId = input.participationAgreementId || position.participationAgreementId;
    const agreement = participationAgreementId ? this.getAgreement(participationAgreementId) : null;
    if (!agreement || agreement.status !== 'EXECUTED' || agreement.positionId !== positionId || agreement.participantId !== position.participantId || agreement.financedPositionId !== position.financedPositionId) throw new Error('Executed secondary participation agreement does not match the marketplace position.');
    const existing = this.domain.list(TYPES.SETTLEMENT_PREPARATION).find((r) => r.positionId === positionId && !['CANCELLED', 'CLOSED'].includes(r.status)); if (existing) return existing;
    const timestamp = now();
    const preparation = { settlementPreparationId: input.settlementPreparationId || id('FMSP'), participationAgreementId, positionId, financedPositionId: position.financedPositionId, distributionAuthorizationId: position.distributionAuthorizationId || null, commitmentId: position.commitmentId, listingId: position.listingId, instrumentId: position.instrumentId, opportunityId: position.opportunityId, participantId: position.participantId, issuerParticipantId: listing.issuerParticipantId, amount: position.totalAmount, currency: position.currency, quantity: position.quantity, transactionRouteId: listing.transactionRouteId, settlementRouteId: listing.settlementRouteId, paymentSourceReference: input.paymentSourceReference || null, destinationReference: input.destinationReference || null, status: 'PREPARED', settlementStatus: 'NOT_STARTED', createdBy: actorId, createdAt: timestamp, updatedAt: timestamp };
    const updatedPosition = { ...position, status: 'SETTLEMENT_PREPARED', settlementPreparationId: preparation.settlementPreparationId, participationAgreementId };
    const lifecycle = { id: id('LE'), objectType: TYPES.POSITION, objectId: positionId, eventType: 'FUNDING_MARKETPLACE_POSITION_PREPARED_FOR_SETTLEMENT', actorId, payload: { financedPositionId: position.financedPositionId, participationAgreementId, settlementPreparationId: preparation.settlementPreparationId, amount: preparation.amount, currency: preparation.currency, onChainStatus: 'NOT_PROJECTED' }, occurredAt: timestamp };
    await this.domain.atomicPut([
      { type: TYPES.SETTLEMENT_PREPARATION, id: preparation.settlementPreparationId, payload: preparation, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARED' },
      { type: TYPES.POSITION, id: positionId, payload: updatedPosition, actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_SETTLEMENT_PREPARED' },
      { type: TYPES.LIFECYCLE_EVENT, id: lifecycle.id, payload: lifecycle, actorId, eventType: lifecycle.eventType },
    ]);
    return preparation;
  }
}

export { TYPES as FUNDING_MARKETPLACE_ALLOCATION_RECORD_TYPES };