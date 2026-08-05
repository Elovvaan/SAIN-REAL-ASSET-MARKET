import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY', POSITION: 'FUNDING_MARKETPLACE_POSITION', SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION',
  SETTLEMENT_REVIEW: 'FUNDING_MARKETPLACE_SETTLEMENT_REVIEW', SETTLEMENT_AUTHORIZATION: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION',
  SRA_TRANSACTION: 'SRA_TRANSACTION', LIFECYCLE_EVENT: 'LIFECYCLE_EVENT',
});
const DECISIONS = new Set(['AUTHORIZED', 'CHANGES_REQUIRED', 'REJECTED']);
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();

export class FundingMarketplaceSettlementService {
  constructor(persistentDomain) { this.domain = persistentDomain; }
  async initialize() { await this.domain.hydrate(Object.values(TYPES)); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 12', purpose: 'CONTROLLED_SETTLEMENT_AND_FINAL_OWNERSHIP_RECOGNITION', settlementReviews: this.domain.list(TYPES.SETTLEMENT_REVIEW).length, settlementAuthorizations: this.domain.list(TYPES.SETTLEMENT_AUTHORIZATION).length, settlementTransactions: this.domain.list(TYPES.SRA_TRANSACTION).filter((r) => r.transactionType === 'MARKETPLACE_SETTLEMENT').length }; }
  getPreparation(preparationId) { return this.domain.get(TYPES.SETTLEMENT_PREPARATION, preparationId); }
  getReview(reviewId) { return this.domain.get(TYPES.SETTLEMENT_REVIEW, reviewId); }
  listReviews(filters = {}) { return this.domain.list(TYPES.SETTLEMENT_REVIEW).filter((r) => (!filters.preparationId || r.settlementPreparationId === filters.preparationId) && (!filters.status || r.status === filters.status)); }
  listAuthorizations(filters = {}) { return this.domain.list(TYPES.SETTLEMENT_AUTHORIZATION).filter((r) => (!filters.positionId || r.positionId === filters.positionId) && (!filters.status || r.status === filters.status)); }

  assessPreparation(preparationId) {
    const preparation = this.getPreparation(preparationId); if (!preparation) throw new Error('Settlement preparation was not found.');
    const position = this.domain.get(TYPES.POSITION, preparation.positionId); if (!position) throw new Error('Marketplace position was not found.');
    const checks = { preparationReady: preparation.status === 'PREPARED', settlementNotStarted: preparation.settlementStatus === 'NOT_STARTED', positionPrepared: position.status === 'SETTLEMENT_PREPARED', positionPendingSettlement: position.ownershipStatus === 'PENDING_SETTLEMENT', amountValid: Number(preparation.amount) > 0, currencyPresent: Boolean(preparation.currency), quantityValid: Number(preparation.quantity) > 0, participantPresent: Boolean(preparation.participantId), issuerPresent: Boolean(preparation.issuerParticipantId), transactionRoutePresent: Boolean(preparation.transactionRouteId), settlementRoutePresent: Boolean(preparation.settlementRouteId), paymentSourcePresent: Boolean(preparation.paymentSourceReference), destinationPresent: Boolean(preparation.destinationReference) };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { settlementPreparationId: preparationId, positionId: preparation.positionId, checks, blockers, readyForSettlementAuthorization: blockers.length === 0 };
  }

  async startReview(preparationId, input = {}, actorId = null) {
    const preparation = this.getPreparation(preparationId); if (!preparation) throw new Error('Settlement preparation was not found.');
    const existing = this.domain.list(TYPES.SETTLEMENT_REVIEW).find((r) => r.settlementPreparationId === preparationId && r.status === 'IN_REVIEW'); if (existing) return existing;
    const timestamp = now();
    const review = { settlementReviewId: input.settlementReviewId || id('FMSR'), settlementPreparationId: preparationId, positionId: preparation.positionId, opportunityId: preparation.opportunityId, assessment: this.assessPreparation(preparationId), status: 'IN_REVIEW', startedBy: actorId, startedAt: timestamp, decision: null, rationale: null, decidedBy: null, decidedAt: null };
    await this.domain.atomicPut([
      { type: TYPES.SETTLEMENT_REVIEW, id: review.settlementReviewId, payload: review, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_REVIEW_STARTED' },
      { type: TYPES.SETTLEMENT_PREPARATION, id: preparationId, payload: { ...preparation, status: 'IN_REVIEW', settlementReviewId: review.settlementReviewId, updatedAt: timestamp }, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION_IN_REVIEW' },
    ]);
    return review;
  }

  async decide(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId); if (!review) throw new Error('Settlement review was not found.'); if (review.status !== 'IN_REVIEW') throw new Error('Settlement review must be in review before a decision is recorded.'); if (!DECISIONS.has(input?.decision)) throw new Error(`Unsupported settlement decision: ${input?.decision}`);
    const assessment = this.assessPreparation(review.settlementPreparationId); if (input.decision === 'AUTHORIZED' && !assessment.readyForSettlementAuthorization) { const error = new Error('Settlement preparation is not ready for authorization.'); error.code = 'SETTLEMENT_REVIEW_INCOMPLETE'; error.assessment = assessment; throw error; }
    const preparation = this.getPreparation(review.settlementPreparationId), decidedAt = now();
    const updatedReview = { ...review, assessment, status: input.decision, decision: input.decision, rationale: input.rationale || null, decidedBy: actorId, decidedAt };
    const updatedPreparation = { ...preparation, status: input.decision === 'AUTHORIZED' ? 'AUTHORIZED' : input.decision, settlementStatus: input.decision === 'AUTHORIZED' ? 'AUTHORIZED' : preparation.settlementStatus, updatedAt: decidedAt };
    let authorization = null;
    const changes = [
      { type: TYPES.SETTLEMENT_REVIEW, id: reviewId, payload: updatedReview, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_REVIEW_DECIDED' },
      { type: TYPES.SETTLEMENT_PREPARATION, id: preparation.settlementPreparationId, payload: updatedPreparation, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION_DECIDED' },
    ];
    if (input.decision === 'AUTHORIZED') {
      authorization = { settlementAuthorizationId: id('FMSA'), settlementReviewId: reviewId, settlementPreparationId: preparation.settlementPreparationId, positionId: preparation.positionId, opportunityId: preparation.opportunityId, participantId: preparation.participantId, issuerParticipantId: preparation.issuerParticipantId, amount: preparation.amount, currency: preparation.currency, quantity: preparation.quantity, transactionRouteId: preparation.transactionRouteId, settlementRouteId: preparation.settlementRouteId, paymentSourceReference: preparation.paymentSourceReference, destinationReference: preparation.destinationReference, status: 'AUTHORIZED', authorizedBy: actorId, authorizedAt: decidedAt, consumedAt: null, settlementTransactionId: null };
      changes.push({ type: TYPES.SETTLEMENT_AUTHORIZATION, id: authorization.settlementAuthorizationId, payload: authorization, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZED' });
    }
    await this.domain.atomicPut(changes);
    return { review: updatedReview, authorization };
  }

  async settle(authorizationId, input = {}, actorId = null) {
    const authorization = this.domain.get(TYPES.SETTLEMENT_AUTHORIZATION, authorizationId); if (!authorization) throw new Error('Settlement authorization was not found.'); if (authorization.status !== 'AUTHORIZED' || authorization.consumedAt) throw new Error('Settlement authorization is not available for use.');
    const preparation = this.getPreparation(authorization.settlementPreparationId), position = this.domain.get(TYPES.POSITION, authorization.positionId); if (!preparation || !position) throw new Error('Required settlement records were not found.'); if (position.ownershipStatus !== 'PENDING_SETTLEMENT' || position.settlementStatus !== 'NOT_STARTED') throw new Error('Position is not available for settlement.');
    const settledAt = input.settledAt || now();
    const transaction = { transactionId: input.transactionId || id('SRATX'), transactionType: 'MARKETPLACE_SETTLEMENT', positionId: position.positionId, commitmentId: position.commitmentId, listingId: position.listingId, instrumentId: position.instrumentId, opportunityId: position.opportunityId, participantId: position.participantId, issuerParticipantId: authorization.issuerParticipantId, settlementAuthorizationId: authorizationId, amount: authorization.amount, currency: authorization.currency, quantity: authorization.quantity, transactionRouteId: authorization.transactionRouteId, settlementRouteId: authorization.settlementRouteId, paymentSourceReference: authorization.paymentSourceReference, destinationReference: authorization.destinationReference, externalSettlementReference: input.externalSettlementReference || null, state: 'RECORDED', status: 'SETTLED', recordedBy: actorId, recordedAt: settledAt };
    const settledPosition = { ...position, ownershipStatus: 'RECOGNIZED', status: 'ACTIVE', settlementStatus: 'SETTLED', settlementAuthorizationId: authorizationId, settlementTransactionId: transaction.transactionId, settledAt, onChainStatus: position.onChainStatus || 'NOT_PROJECTED', updatedAt: settledAt };
    const completedPreparation = { ...preparation, status: 'COMPLETED', settlementStatus: 'SETTLED', settlementTransactionId: transaction.transactionId, completedAt: settledAt, updatedAt: settledAt };
    const consumedAuthorization = { ...authorization, status: 'CONSUMED', consumedAt: settledAt, settlementTransactionId: transaction.transactionId };
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, position.opportunityId);
    const lifecycle = { id: id('LE'), objectType: TYPES.POSITION, objectId: position.positionId, eventType: 'FUNDING_MARKETPLACE_POSITION_OWNERSHIP_RECOGNIZED', actorId, payload: { settlementAuthorizationId: authorizationId, transactionId: transaction.transactionId, amount: transaction.amount, currency: transaction.currency, ownershipStatus: 'RECOGNIZED', onChainStatus: settledPosition.onChainStatus }, occurredAt: settledAt };
    const changes = [
      { type: TYPES.SRA_TRANSACTION, id: transaction.transactionId, payload: transaction, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_RECORDED' },
      { type: TYPES.POSITION, id: position.positionId, payload: settledPosition, actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_SETTLED' },
      { type: TYPES.SETTLEMENT_PREPARATION, id: preparation.settlementPreparationId, payload: completedPreparation, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_COMPLETED' },
      { type: TYPES.SETTLEMENT_AUTHORIZATION, id: authorizationId, payload: consumedAuthorization, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION_CONSUMED' },
      { type: TYPES.LIFECYCLE_EVENT, id: lifecycle.id, payload: lifecycle, actorId, eventType: lifecycle.eventType },
    ];
    if (opportunity) changes.push({ type: TYPES.OPPORTUNITY, id: opportunity.opportunityId, payload: { ...opportunity, status: 'POSITION_SETTLED', fundingPhase: 'OWNERSHIP_RECOGNIZED', updatedAt: settledAt, history: [...(opportunity.history || []), { from: opportunity.status, to: 'POSITION_SETTLED', at: settledAt, actorId, note: position.positionId }] }, actorId, eventType: 'FUNDING_OPPORTUNITY_POSITION_SETTLED' });
    await this.domain.atomicPut(changes);
    return { position: settledPosition, transaction };
  }
}

export { TYPES as FUNDING_MARKETPLACE_SETTLEMENT_RECORD_TYPES };
