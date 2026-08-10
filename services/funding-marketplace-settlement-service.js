import crypto from 'node:crypto';
import { TreasuryFinancingCapacityService } from './treasury-financing-capacity-service.js';

const TYPES = Object.freeze({
  POSITION: 'FUNDING_MARKETPLACE_POSITION', FINANCED_POSITION: 'FINANCED_POSITION', SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION',
  SETTLEMENT_REVIEW: 'FUNDING_MARKETPLACE_SETTLEMENT_REVIEW', SETTLEMENT_AUTHORIZATION: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION',
  SETTLEMENT_CONFIRMATION: 'FUNDING_MARKETPLACE_SETTLEMENT_CONFIRMATION', SRA_TRANSACTION: 'SRA_TRANSACTION', LEDGER_ENTRY: 'LEDGER_ENTRY', LIFECYCLE_EVENT: 'LIFECYCLE_EVENT',
});
const DECISIONS = new Set(['AUTHORIZED', 'CHANGES_REQUIRED', 'REJECTED']);
const CONFIRMATION_SOURCES = new Set(['EXTERNAL_RAIL', 'INTERNAL_LEDGER']);
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();
const evidenceHash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class FundingMarketplaceSettlementService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
    this.financingCapacity = new TreasuryFinancingCapacityService(persistentDomain);
  }
  async initialize() { await this.domain.hydrate(Object.values(TYPES)); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 12', purpose: 'VERIFIED_POSITION_TRANSFER_AND_OWNERSHIP_RECOGNITION', settlementReviews: this.domain.list(TYPES.SETTLEMENT_REVIEW).length, settlementAuthorizations: this.domain.list(TYPES.SETTLEMENT_AUTHORIZATION).length, settlementConfirmations: this.domain.list(TYPES.SETTLEMENT_CONFIRMATION).length, verifiedConfirmations: this.domain.list(TYPES.SETTLEMENT_CONFIRMATION).filter((r) => r.status === 'VERIFIED').length, settlementTransactions: this.domain.list(TYPES.SRA_TRANSACTION).filter((r) => r.transactionType === 'MARKETPLACE_SETTLEMENT').length }; }
  getPreparation(preparationId) { return this.domain.get(TYPES.SETTLEMENT_PREPARATION, preparationId); }
  getReview(reviewId) { return this.domain.get(TYPES.SETTLEMENT_REVIEW, reviewId); }
  getConfirmation(confirmationId) { return this.domain.get(TYPES.SETTLEMENT_CONFIRMATION, confirmationId); }
  listReviews(filters = {}) { return this.domain.list(TYPES.SETTLEMENT_REVIEW).filter((r) => (!filters.preparationId || r.settlementPreparationId === filters.preparationId) && (!filters.status || r.status === filters.status)); }
  listAuthorizations(filters = {}) { return this.domain.list(TYPES.SETTLEMENT_AUTHORIZATION).filter((r) => (!filters.positionId || r.positionId === filters.positionId) && (!filters.status || r.status === filters.status)); }
  listConfirmations(filters = {}) { return this.domain.list(TYPES.SETTLEMENT_CONFIRMATION).filter((r) => (!filters.authorizationId || r.settlementAuthorizationId === filters.authorizationId) && (!filters.positionId || r.positionId === filters.positionId) && (!filters.status || r.status === filters.status) && (!filters.sourceType || r.sourceType === filters.sourceType)); }

  assessPreparation(preparationId) {
    const preparation = this.getPreparation(preparationId); if (!preparation) throw new Error('Settlement preparation was not found.');
    const position = this.domain.get(TYPES.POSITION, preparation.positionId); if (!position) throw new Error('Marketplace position was not found.');
    const financedPosition = preparation.financedPositionId ? this.domain.get(TYPES.FINANCED_POSITION, preparation.financedPositionId) : null;
    const checks = { preparationReady: preparation.status === 'PREPARED', settlementNotStarted: preparation.settlementStatus === 'NOT_STARTED', positionPrepared: position.status === 'SETTLEMENT_PREPARED', positionPendingSettlement: position.ownershipStatus === 'PENDING_SETTLEMENT', financedPositionLinked: Boolean(financedPosition), financedPositionInMarket: ['IN_MARKET','MARKETPLACE_LIVE','PARTIALLY_TRANSFERRED'].includes(financedPosition?.distributionStatus), amountValid: Number(preparation.amount) > 0, currencyPresent: Boolean(preparation.currency), quantityValid: Number(preparation.quantity) > 0, participantPresent: Boolean(preparation.participantId), issuerPresent: Boolean(preparation.issuerParticipantId), transactionRoutePresent: Boolean(preparation.transactionRouteId), settlementRoutePresent: Boolean(preparation.settlementRouteId), paymentSourcePresent: Boolean(preparation.paymentSourceReference), destinationPresent: Boolean(preparation.destinationReference) };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { settlementPreparationId: preparationId, positionId: preparation.positionId, financedPositionId: preparation.financedPositionId || null, checks, blockers, readyForSettlementAuthorization: blockers.length === 0 };
  }

  async startReview(preparationId, input = {}, actorId = null) {
    const preparation = this.getPreparation(preparationId); if (!preparation) throw new Error('Settlement preparation was not found.');
    const existing = this.domain.list(TYPES.SETTLEMENT_REVIEW).find((r) => r.settlementPreparationId === preparationId && r.status === 'IN_REVIEW'); if (existing) return existing;
    const timestamp = now();
    const review = { settlementReviewId: input.settlementReviewId || id('FMSR'), settlementPreparationId: preparationId, positionId: preparation.positionId, financedPositionId: preparation.financedPositionId || null, opportunityId: preparation.opportunityId, assessment: this.assessPreparation(preparationId), status: 'IN_REVIEW', startedBy: actorId, startedAt: timestamp, decision: null, rationale: null, decidedBy: null, decidedAt: null };
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
    let treasuryCapacity = null;
    if (input.decision === 'AUTHORIZED' && this.financingCapacity.isTreasurySource(preparation.paymentSourceReference)) {
      treasuryCapacity = this.financingCapacity.assertAvailable(preparation.amount);
    }
    const updatedReview = { ...review, assessment, status: input.decision, decision: input.decision, rationale: input.rationale || null, decidedBy: actorId, decidedAt };
    const updatedPreparation = { ...preparation, status: input.decision === 'AUTHORIZED' ? 'AUTHORIZED' : input.decision, settlementStatus: input.decision === 'AUTHORIZED' ? 'AWAITING_CONFIRMATION' : preparation.settlementStatus, updatedAt: decidedAt };
    let authorization = null;
    const changes = [
      { type: TYPES.SETTLEMENT_REVIEW, id: reviewId, payload: updatedReview, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_REVIEW_DECIDED' },
      { type: TYPES.SETTLEMENT_PREPARATION, id: preparation.settlementPreparationId, payload: updatedPreparation, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION_DECIDED' },
    ];
    if (input.decision === 'AUTHORIZED') {
      authorization = { settlementAuthorizationId: id('FMSA'), settlementReviewId: reviewId, settlementPreparationId: preparation.settlementPreparationId, positionId: preparation.positionId, financedPositionId: preparation.financedPositionId || null, distributionAuthorizationId: preparation.distributionAuthorizationId || null, opportunityId: preparation.opportunityId, participantId: preparation.participantId, issuerParticipantId: preparation.issuerParticipantId, amount: preparation.amount, currency: preparation.currency, quantity: preparation.quantity, transactionRouteId: preparation.transactionRouteId, settlementRouteId: preparation.settlementRouteId, paymentSourceReference: preparation.paymentSourceReference, destinationReference: preparation.destinationReference, treasuryCapacitySource: treasuryCapacity ? 'SRA_PLATFORM_TREASURY' : null, status: 'AWAITING_CONFIRMATION', authorizedBy: actorId, authorizedAt: decidedAt, verifiedConfirmationId: null, consumedAt: null, settlementTransactionId: null };
      changes.push({ type: TYPES.SETTLEMENT_AUTHORIZATION, id: authorization.settlementAuthorizationId, payload: authorization, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZED' });
    }
    await this.domain.atomicPut(changes);
    return { review: updatedReview, authorization, treasuryCapacity: treasuryCapacity ? this.financingCapacity.summary() : null };
  }

  validateConfirmationAgainstAuthorization(authorization, input) {
    const amount = Number(input.amount);
    const currency = String(input.currency || '').toUpperCase();
    const checks = {
      amountMatches: Number.isFinite(amount) && amount === Number(authorization.amount),
      currencyMatches: currency === String(authorization.currency || '').toUpperCase(),
      sourceMatches: String(input.paymentSourceReference || '') === String(authorization.paymentSourceReference || ''),
      destinationMatches: String(input.destinationReference || '') === String(authorization.destinationReference || ''),
      providerReferencePresent: Boolean(input.providerReference),
      confirmedAtPresent: Boolean(input.confirmedAt),
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { checks, blockers, valid: blockers.length === 0 };
  }

  async registerConfirmation(authorizationId, input = {}, actorId = null) {
    const authorization = this.domain.get(TYPES.SETTLEMENT_AUTHORIZATION, authorizationId); if (!authorization) throw new Error('Settlement authorization was not found.');
    if (!['AWAITING_CONFIRMATION', 'CONFIRMATION_RECEIVED'].includes(authorization.status) || authorization.consumedAt) throw new Error('Settlement authorization is not awaiting confirmation.');
    const sourceType = String(input.sourceType || '').toUpperCase(); if (!CONFIRMATION_SOURCES.has(sourceType)) throw new Error('sourceType must be EXTERNAL_RAIL or INTERNAL_LEDGER.');
    if (this.listConfirmations({ authorizationId }).some((r) => r.providerReference === input.providerReference && !['REJECTED', 'REVERSED'].includes(r.status))) throw new Error('That settlement provider reference is already registered.');
    let trustedRecord = null;
    if (sourceType === 'INTERNAL_LEDGER') {
      if (!input.ledgerEntryId) throw new Error('ledgerEntryId is required for internal-ledger confirmation.');
      trustedRecord = this.domain.get(TYPES.LEDGER_ENTRY, input.ledgerEntryId) || this.domain.get(TYPES.SRA_TRANSACTION, input.ledgerEntryId);
      if (!trustedRecord) throw new Error('Trusted internal ledger record was not found.');
      if (!['POSTED', 'SETTLED', 'RECORDED', 'COMPLETED'].includes(String(trustedRecord.status || trustedRecord.state || '').toUpperCase())) throw new Error('Internal ledger record is not in a settled state.');
    }
    const assessment = this.validateConfirmationAgainstAuthorization(authorization, input);
    const receivedAt = now();
    const confirmation = { settlementConfirmationId: input.settlementConfirmationId || id('FMSC'), settlementAuthorizationId: authorizationId, settlementPreparationId: authorization.settlementPreparationId, positionId: authorization.positionId, financedPositionId: authorization.financedPositionId || null, opportunityId: authorization.opportunityId, sourceType, providerId: input.providerId || null, providerReference: input.providerReference, networkReference: input.networkReference || null, ledgerEntryId: input.ledgerEntryId || null, amount: Number(input.amount), currency: String(input.currency || '').toUpperCase(), paymentSourceReference: input.paymentSourceReference, destinationReference: input.destinationReference, providerStatus: String(input.providerStatus || 'CONFIRMED').toUpperCase(), confirmedAt: input.confirmedAt, receivedAt, rawEvidenceHash: evidenceHash(input.rawEvidence || input), assessment, status: assessment.valid ? 'RECEIVED' : 'REJECTED', receivedBy: actorId, verifiedBy: null, verifiedAt: null, rejectionReason: assessment.valid ? null : assessment.blockers.join(', '), reversedAt: null };
    const updatedAuthorization = { ...authorization, status: assessment.valid ? 'CONFIRMATION_RECEIVED' : authorization.status, settlementConfirmationId: assessment.valid ? confirmation.settlementConfirmationId : authorization.settlementConfirmationId || null };
    await this.domain.atomicPut([
      { type: TYPES.SETTLEMENT_CONFIRMATION, id: confirmation.settlementConfirmationId, payload: confirmation, actorId, eventType: assessment.valid ? 'FUNDING_SETTLEMENT_CONFIRMATION_RECEIVED' : 'FUNDING_SETTLEMENT_CONFIRMATION_REJECTED' },
      { type: TYPES.SETTLEMENT_AUTHORIZATION, id: authorizationId, payload: updatedAuthorization, actorId, eventType: 'FUNDING_SETTLEMENT_AUTHORIZATION_CONFIRMATION_UPDATED' },
    ]);
    return confirmation;
  }

  async verifyConfirmation(confirmationId, actorId = null) {
    const confirmation = this.getConfirmation(confirmationId); if (!confirmation) throw new Error('Settlement confirmation was not found.'); if (confirmation.status !== 'RECEIVED') throw new Error('Settlement confirmation must be received before verification.');
    const authorization = this.domain.get(TYPES.SETTLEMENT_AUTHORIZATION, confirmation.settlementAuthorizationId); if (!authorization || authorization.consumedAt) throw new Error('Settlement authorization is not available.');
    const assessment = this.validateConfirmationAgainstAuthorization(authorization, confirmation); if (!assessment.valid) { const error = new Error('Settlement confirmation does not match the authorization.'); error.code = 'SETTLEMENT_CONFIRMATION_MISMATCH'; error.assessment = assessment; throw error; }
    if (!['CONFIRMED', 'SETTLED', 'RECONCILED', 'COMPLETED'].includes(confirmation.providerStatus)) throw new Error('Settlement provider has not confirmed completion.');
    const verifiedAt = now();
    const verified = { ...confirmation, assessment, status: 'VERIFIED', verifiedBy: actorId, verifiedAt };
    const updatedAuthorization = { ...authorization, status: 'CONFIRMED', verifiedConfirmationId: confirmationId, confirmedAt: confirmation.confirmedAt, updatedAt: verifiedAt };
    const preparation = this.getPreparation(authorization.settlementPreparationId);
    await this.domain.atomicPut([
      { type: TYPES.SETTLEMENT_CONFIRMATION, id: confirmationId, payload: verified, actorId, eventType: 'FUNDING_SETTLEMENT_CONFIRMATION_VERIFIED' },
      { type: TYPES.SETTLEMENT_AUTHORIZATION, id: authorization.settlementAuthorizationId, payload: updatedAuthorization, actorId, eventType: 'FUNDING_SETTLEMENT_AUTHORIZATION_CONFIRMED' },
      { type: TYPES.SETTLEMENT_PREPARATION, id: preparation.settlementPreparationId, payload: { ...preparation, settlementStatus: 'CONFIRMED', settlementConfirmationId: confirmationId, updatedAt: verifiedAt }, actorId, eventType: 'FUNDING_SETTLEMENT_PREPARATION_CONFIRMED' },
    ]);
    return verified;
  }

  async recordReversal(confirmationId, input = {}, actorId = null) {
    const confirmation = this.getConfirmation(confirmationId); if (!confirmation) throw new Error('Settlement confirmation was not found.'); if (!['RECEIVED', 'VERIFIED'].includes(confirmation.status)) throw new Error('Settlement confirmation cannot be reversed from its current state.');
    const reversedAt = input.reversedAt || now();
    const reversed = { ...confirmation, status: 'REVERSED', reversalReference: input.reversalReference || null, reversalReason: input.reason || null, reversedAt, reversedBy: actorId };
    const authorization = this.domain.get(TYPES.SETTLEMENT_AUTHORIZATION, confirmation.settlementAuthorizationId);
    const changes = [{ type: TYPES.SETTLEMENT_CONFIRMATION, id: confirmationId, payload: reversed, actorId, eventType: 'FUNDING_SETTLEMENT_CONFIRMATION_REVERSED' }];
    if (authorization && !authorization.consumedAt) changes.push({ type: TYPES.SETTLEMENT_AUTHORIZATION, id: authorization.settlementAuthorizationId, payload: { ...authorization, status: 'AWAITING_CONFIRMATION', verifiedConfirmationId: null, settlementConfirmationId: null }, actorId, eventType: 'FUNDING_SETTLEMENT_AUTHORIZATION_REOPENED' });
    await this.domain.atomicPut(changes); return reversed;
  }

  async settle(authorizationId, input = {}, actorId = null) {
    const authorization = this.domain.get(TYPES.SETTLEMENT_AUTHORIZATION, authorizationId); if (!authorization) throw new Error('Settlement authorization was not found.');
    if (authorization.status !== 'CONFIRMED' || !authorization.verifiedConfirmationId || authorization.consumedAt) { const error = new Error('Verified settlement confirmation is required before ownership recognition.'); error.code = 'VERIFIED_SETTLEMENT_CONFIRMATION_REQUIRED'; throw error; }
    const confirmation = this.getConfirmation(authorization.verifiedConfirmationId); if (!confirmation || confirmation.status !== 'VERIFIED') { const error = new Error('Verified settlement confirmation is unavailable.'); error.code = 'VERIFIED_SETTLEMENT_CONFIRMATION_REQUIRED'; throw error; }
    const preparation = this.getPreparation(authorization.settlementPreparationId), position = this.domain.get(TYPES.POSITION, authorization.positionId); if (!preparation || !position) throw new Error('Required settlement records were not found.'); if (position.ownershipStatus !== 'PENDING_SETTLEMENT' || position.settlementStatus !== 'NOT_STARTED') throw new Error('Position is not available for settlement.');
    const financedPosition = authorization.financedPositionId ? this.domain.get(TYPES.FINANCED_POSITION, authorization.financedPositionId) : null;
    if (!financedPosition) throw new Error('Underlying financed position was not found.');
    const transferQuantity = Number(authorization.quantity);
    if (!Number.isFinite(transferQuantity) || transferQuantity <= 0 || transferQuantity > Number(financedPosition.offeredAmount || 0)) throw new Error('Settlement quantity exceeds the remaining offered financed position.');
    const settledAt = input.settledAt || confirmation.confirmedAt || now();
    const transaction = { transactionId: input.transactionId || id('SRATX'), transactionType: 'MARKETPLACE_SETTLEMENT', positionId: position.positionId, financedPositionId: financedPosition.positionId, commitmentId: position.commitmentId, listingId: position.listingId, instrumentId: position.instrumentId, opportunityId: position.opportunityId, participantId: position.participantId, issuerParticipantId: authorization.issuerParticipantId, settlementAuthorizationId: authorizationId, settlementConfirmationId: confirmation.settlementConfirmationId, amount: authorization.amount, currency: authorization.currency, quantity: authorization.quantity, transactionRouteId: authorization.transactionRouteId, settlementRouteId: authorization.settlementRouteId, paymentSourceReference: authorization.paymentSourceReference, destinationReference: authorization.destinationReference, externalSettlementReference: confirmation.providerReference, networkReference: confirmation.networkReference, evidenceHash: confirmation.rawEvidenceHash, state: 'RECORDED', status: 'SETTLED', recordedBy: actorId, recordedAt: settledAt };
    const settledPosition = { ...position, ownershipStatus: 'RECOGNIZED', status: 'ACTIVE', settlementStatus: 'SETTLED', settlementAuthorizationId: authorizationId, settlementConfirmationId: confirmation.settlementConfirmationId, settlementTransactionId: transaction.transactionId, settledAt, onChainStatus: position.onChainStatus || 'NOT_PROJECTED', updatedAt: settledAt };
    const completedPreparation = { ...preparation, status: 'COMPLETED', settlementStatus: 'SETTLED', settlementConfirmationId: confirmation.settlementConfirmationId, settlementTransactionId: transaction.transactionId, completedAt: settledAt, updatedAt: settledAt };
    const consumedAuthorization = { ...authorization, status: 'CONSUMED', consumedAt: settledAt, settlementTransactionId: transaction.transactionId };
    const consumedConfirmation = { ...confirmation, status: 'CONSUMED', settlementTransactionId: transaction.transactionId, consumedAt: settledAt };
    const remainingOffered = Number((Number(financedPosition.offeredAmount || 0) - transferQuantity).toFixed(8));
    const transferredAmount = Number((Number(financedPosition.transferredAmount || 0) + transferQuantity).toFixed(8));
    const updatedFinancedPosition = { ...financedPosition, offeredAmount: remainingOffered, transferredAmount, distributionStatus: remainingOffered > 0 ? 'PARTIALLY_TRANSFERRED' : 'DISTRIBUTED', updatedAt: settledAt };
    const lifecycle = { id: id('LE'), objectType: TYPES.POSITION, objectId: position.positionId, eventType: 'FUNDING_MARKETPLACE_POSITION_OWNERSHIP_RECOGNIZED', actorId, payload: { financedPositionId: financedPosition.positionId, settlementAuthorizationId: authorizationId, settlementConfirmationId: confirmation.settlementConfirmationId, transactionId: transaction.transactionId, amount: transaction.amount, currency: transaction.currency, providerReference: confirmation.providerReference, ownershipStatus: 'RECOGNIZED', onChainStatus: settledPosition.onChainStatus }, occurredAt: settledAt };
    await this.domain.atomicPut([
      { type: TYPES.SRA_TRANSACTION, id: transaction.transactionId, payload: transaction, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_RECORDED' },
      { type: TYPES.POSITION, id: position.positionId, payload: settledPosition, actorId, eventType: 'FUNDING_MARKETPLACE_POSITION_SETTLED' },
      { type: TYPES.FINANCED_POSITION, id: financedPosition.positionId, payload: updatedFinancedPosition, actorId, eventType: 'FINANCED_POSITION_PARTICIPANT_TRANSFER_RECOGNIZED' },
      { type: TYPES.SETTLEMENT_PREPARATION, id: preparation.settlementPreparationId, payload: completedPreparation, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_COMPLETED' },
      { type: TYPES.SETTLEMENT_AUTHORIZATION, id: authorizationId, payload: consumedAuthorization, actorId, eventType: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION_CONSUMED' },
      { type: TYPES.SETTLEMENT_CONFIRMATION, id: confirmation.settlementConfirmationId, payload: consumedConfirmation, actorId, eventType: 'FUNDING_SETTLEMENT_CONFIRMATION_CONSUMED' },
      { type: TYPES.LIFECYCLE_EVENT, id: lifecycle.id, payload: lifecycle, actorId, eventType: lifecycle.eventType },
    ]);
    return { position: settledPosition, financedPosition: updatedFinancedPosition, transaction, confirmation: consumedConfirmation, treasuryCapacity: this.financingCapacity.isTreasurySource(authorization.paymentSourceReference) ? this.financingCapacity.summary() : null };
  }
}

export { TYPES as FUNDING_MARKETPLACE_SETTLEMENT_RECORD_TYPES };