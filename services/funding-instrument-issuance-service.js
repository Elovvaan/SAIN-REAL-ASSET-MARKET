import crypto from 'node:crypto';
import { DETERMINATION_RECORD_TYPES } from './determination-engine-service.js';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY', SRA_INSTRUMENT: 'SRA_INSTRUMENT', ISSUANCE_REQUEST: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST',
  ISSUANCE_REVIEW: 'FUNDING_INSTRUMENT_ISSUANCE_REVIEW', ISSUANCE_AUTHORIZATION: 'FUNDING_INSTRUMENT_ISSUANCE_AUTHORIZATION',
  SRA_TRANSACTION: 'SRA_TRANSACTION', LIFECYCLE_EVENT: 'LIFECYCLE_EVENT',
});
const DECISIONS = new Set(['AUTHORIZED', 'CHANGES_REQUIRED', 'REJECTED']);
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();
const unique = (values = []) => [...new Set(values.filter(Boolean))];

function inspectCanonicalVvr(domain, instrument) {
  if (!instrument.canonicalVerifiedValueRecordId) return { mode: 'LEGACY_COMPATIBILITY', present: false, valid: true, record: null };
  const record = domain.get(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, instrument.canonicalVerifiedValueRecordId);
  const valid = Boolean(record && record.state === 'CANONICAL' && record.immutable === true && Array.isArray(record.permittedUses) && record.permittedUses.includes('CONTRACT_REFERENCE'));
  return { mode: 'CANONICAL_VVR_REFERENCE', present: true, valid, record };
}

function economicBasis(instrument, request = null, vvr = null) {
  const requestedAmount = Number(request?.requestedAmount ?? instrument.requestedAmount ?? 0) || null;
  const recognizedReferenceValue = Number(request?.recognizedReferenceValue ?? instrument.recognizedReferenceValue ?? vvr?.record?.value ?? 0) || null;
  const faceValue = Number(request?.faceValue ?? instrument.faceValue ?? 0) || null;
  return {
    requestedAmount,
    recognizedReferenceValue,
    recognizedReferenceCurrency: request?.recognizedReferenceCurrency || instrument.recognizedReferenceCurrency || vvr?.record?.currency || instrument.currency || null,
    faceValue,
    currency: request?.currency || instrument.currency || null,
    faceValueBasis: request?.faceValueBasis || instrument.faceValueBasis || (instrument.canonicalVerifiedValueRecordId ? 'STRUCTURING_DECISION_WITH_CANONICAL_VVR_REFERENCE' : 'LEGACY_REQUESTED_AMOUNT_BASIS'),
    requestedToRecognizedRatio: recognizedReferenceValue && requestedAmount ? requestedAmount / recognizedReferenceValue : null,
    faceValueToRecognizedRatio: recognizedReferenceValue && faceValue ? faceValue / recognizedReferenceValue : null,
    faceValueVarianceFromRecognized: recognizedReferenceValue && faceValue ? faceValue - recognizedReferenceValue : null,
    canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || request?.canonicalVerifiedValueRecordId || null,
    determinationId: vvr?.record?.determinationId || instrument.referencedDeterminationId || request?.referencedDeterminationId || null,
    snapshotId: vvr?.record?.snapshotId || instrument.referencedSnapshotId || request?.referencedSnapshotId || null,
    valueReferenceMode: vvr?.mode || instrument.valueReferenceArchitecture || request?.valueReferenceArchitecture || 'LEGACY_COMPATIBILITY',
  };
}

export class FundingInstrumentIssuanceService {
  constructor(persistentDomain) { this.domain = persistentDomain; }
  async initialize() { await this.domain.hydrate([...Object.values(TYPES), DETERMINATION_RECORD_TYPES.VERIFIED_VALUE]); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 7', purpose: 'CONTROLLED_INSTRUMENT_ISSUANCE', issuanceReviews: this.domain.list(TYPES.ISSUANCE_REVIEW).length, authorizations: this.domain.list(TYPES.ISSUANCE_AUTHORIZATION).length, issuanceTransactions: this.domain.list(TYPES.SRA_TRANSACTION).filter((r) => r.transactionType === 'INSTRUMENT_ISSUANCE').length }; }
  getRequest(requestId) { return this.domain.get(TYPES.ISSUANCE_REQUEST, requestId); }
  getReview(reviewId) { return this.domain.get(TYPES.ISSUANCE_REVIEW, reviewId); }
  listReviews(filters = {}) { return this.domain.list(TYPES.ISSUANCE_REVIEW).filter((r) => (!filters.issuanceRequestId || r.issuanceRequestId === filters.issuanceRequestId) && (!filters.status || r.status === filters.status)); }
  listAuthorizations(filters = {}) { return this.domain.list(TYPES.ISSUANCE_AUTHORIZATION).filter((r) => (!filters.instrumentId || r.instrumentId === filters.instrumentId) && (!filters.status || r.status === filters.status)); }

  assessRequest(requestId) {
    const request = this.getRequest(requestId); if (!request) throw new Error('Issuance request was not found.');
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, request.instrumentId); if (!instrument) throw new Error('Instrument was not found.');
    const vvr = inspectCanonicalVvr(this.domain, instrument);
    const checks = {
      requestPending: request.status === 'PENDING', instrumentDraft: instrument.state === 'DRAFT', instrumentNotIssued: instrument.issuanceStatus === 'NOT_ISSUED',
      issuerPresent: Boolean(request.issuerParticipantId), faceValueValid: Number(request.faceValue) > 0, currencyPresent: Boolean(request.currency),
      reviewApproved: instrument.reviewDecision === 'APPROVED_FOR_ISSUANCE_REQUEST', verifiedRecordLinked: Boolean(instrument.verifiedRecordId),
      canonicalVvrReferenceValid: vvr.valid, settlementRulePresent: Boolean(instrument.settlementRule), governingDocumentPresent: Boolean(instrument.governingDocumentId),
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    const basis = economicBasis(instrument, request, vvr);
    return {
      issuanceRequestId: requestId,
      instrumentId: instrument.instrumentId,
      checks,
      blockers,
      readyForAuthorization: blockers.length === 0,
      valueReference: { mode: vvr.mode, canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || null, determinationId: vvr.record?.determinationId || null, snapshotId: vvr.record?.snapshotId || null },
      economicBasis: basis,
    };
  }

  async startReview(requestId, input = {}, actorId = null) {
    const request = this.getRequest(requestId); if (!request) throw new Error('Issuance request was not found.'); if (request.status !== 'PENDING') throw new Error(`Issuance review cannot begin from ${request.status}.`);
    const existing = this.domain.list(TYPES.ISSUANCE_REVIEW).find((r) => r.issuanceRequestId === requestId && r.status === 'IN_REVIEW'); if (existing) return existing;
    const timestamp = now();
    const assessment = this.assessRequest(requestId);
    const review = { issuanceReviewId: input.issuanceReviewId || id('FIUR'), issuanceRequestId: requestId, instrumentId: request.instrumentId, opportunityId: request.opportunityId, assessment, economicBasis: assessment.economicBasis, status: 'IN_REVIEW', startedBy: actorId, startedAt: timestamp, decision: null, rationale: null, decidedBy: null, decidedAt: null };
    await this.domain.atomicPut([
      { type: TYPES.ISSUANCE_REVIEW, id: review.issuanceReviewId, payload: review, actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REVIEW_STARTED' },
      { type: TYPES.ISSUANCE_REQUEST, id: requestId, payload: { ...request, status: 'IN_REVIEW', issuanceReviewId: review.issuanceReviewId, updatedAt: timestamp }, actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST_IN_REVIEW' },
    ]);
    return review;
  }

  async decide(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId); if (!review) throw new Error('Issuance review was not found.'); if (review.status !== 'IN_REVIEW') throw new Error('Issuance review must be in review before a decision is recorded.'); if (!DECISIONS.has(input?.decision)) throw new Error(`Unsupported issuance review decision: ${input?.decision}`);
    const assessment = this.assessRequest(review.issuanceRequestId); if (input.decision === 'AUTHORIZED' && !assessment.readyForAuthorization) { const error = new Error('Issuance request is not ready for authorization.'); error.code = 'ISSUANCE_REVIEW_INCOMPLETE'; error.assessment = assessment; throw error; }
    const request = this.getRequest(review.issuanceRequestId), decidedAt = now();
    const updatedReview = { ...review, assessment, economicBasis: assessment.economicBasis, status: input.decision, decision: input.decision, rationale: input.rationale || null, decidedBy: actorId, decidedAt };
    const updatedRequest = { ...request, status: input.decision === 'AUTHORIZED' ? 'AUTHORIZED' : input.decision, authorizationDecision: input.decision, authorizationRationale: input.rationale || null, approvedAt: input.decision === 'AUTHORIZED' ? decidedAt : request.approvedAt, updatedAt: decidedAt };
    let authorization = null;
    const changes = [
      { type: TYPES.ISSUANCE_REVIEW, id: reviewId, payload: updatedReview, actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REVIEW_DECIDED' },
      { type: TYPES.ISSUANCE_REQUEST, id: request.issuanceRequestId, payload: updatedRequest, actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST_DECIDED' },
    ];
    if (input.decision === 'AUTHORIZED') {
      const basis = assessment.economicBasis;
      authorization = {
        issuanceAuthorizationId: id('FIAU'), issuanceRequestId: request.issuanceRequestId, issuanceReviewId: reviewId, instrumentId: request.instrumentId, opportunityId: request.opportunityId,
        requestedAmount: basis.requestedAmount, recognizedReferenceValue: basis.recognizedReferenceValue, recognizedReferenceCurrency: basis.recognizedReferenceCurrency,
        authorizedFaceValue: request.faceValue, faceValueBasis: basis.faceValueBasis, requestedToRecognizedRatio: basis.requestedToRecognizedRatio, faceValueToRecognizedRatio: basis.faceValueToRecognizedRatio, faceValueVarianceFromRecognized: basis.faceValueVarianceFromRecognized,
        economicBasis: basis, currency: request.currency, canonicalVerifiedValueRecordId: assessment.valueReference.canonicalVerifiedValueRecordId, referencedDeterminationId: assessment.valueReference.determinationId, referencedSnapshotId: assessment.valueReference.snapshotId, valueReferenceMode: assessment.valueReference.mode,
        authorizedIssueDate: input.authorizedIssueDate || request.requestedIssueDate || null, authorizedMaturityDate: input.authorizedMaturityDate || request.requestedMaturityDate || null,
        conditions: unique([...(request.issuanceConditions || []), ...(input.conditions || [])]), status: 'AUTHORIZED', authorizedBy: actorId, authorizedAt: decidedAt, consumedAt: null, issuanceTransactionId: null,
      };
      changes.push({ type: TYPES.ISSUANCE_AUTHORIZATION, id: authorization.issuanceAuthorizationId, payload: authorization, actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_AUTHORIZED' });
    }
    await this.domain.atomicPut(changes);
    return { review: updatedReview, authorization };
  }

  async issue(authorizationId, input = {}, actorId = null) {
    const authorization = this.domain.get(TYPES.ISSUANCE_AUTHORIZATION, authorizationId); if (!authorization) throw new Error('Issuance authorization was not found.'); if (authorization.status !== 'AUTHORIZED' || authorization.consumedAt) throw new Error('Issuance authorization is not available for use.');
    const request = this.getRequest(authorization.issuanceRequestId), instrument = this.domain.get(TYPES.SRA_INSTRUMENT, authorization.instrumentId); if (!request || !instrument) throw new Error('Required issuance records were not found.'); if (instrument.issuanceStatus !== 'NOT_ISSUED') throw new Error('Instrument has already been issued or otherwise closed.');
    const vvr = inspectCanonicalVvr(this.domain, instrument); if (!vvr.valid) throw new Error('Canonical Verified Value Record reference is no longer valid for issuance.');
    const issuedAt = input.issuedAt || now();
    const basis = authorization.economicBasis || economicBasis(instrument, request, vvr);
    const transaction = {
      transactionId: input.transactionId || id('SRATX'), transactionType: 'INSTRUMENT_ISSUANCE', instrumentId: instrument.instrumentId, opportunityId: instrument.opportunityId, issuerParticipantId: instrument.issuerParticipantId, issuanceAuthorizationId: authorizationId,
      requestedAmount: basis.requestedAmount, recognizedReferenceValue: basis.recognizedReferenceValue, recognizedReferenceCurrency: basis.recognizedReferenceCurrency, faceValueBasis: basis.faceValueBasis, requestedToRecognizedRatio: basis.requestedToRecognizedRatio, faceValueToRecognizedRatio: basis.faceValueToRecognizedRatio, faceValueVarianceFromRecognized: basis.faceValueVarianceFromRecognized, economicBasis: basis,
      canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || null, referencedDeterminationId: vvr.record?.determinationId || authorization.referencedDeterminationId || null, referencedSnapshotId: vvr.record?.snapshotId || authorization.referencedSnapshotId || null,
      amount: authorization.authorizedFaceValue, currency: authorization.currency, issueDate: authorization.authorizedIssueDate || issuedAt, maturityDate: authorization.authorizedMaturityDate || instrument.maturityDate || null, governingDocumentId: instrument.governingDocumentId, settlementRule: instrument.settlementRule, state: 'RECORDED', status: 'RECORDED', recordedBy: actorId, recordedAt: issuedAt,
    };
    const issuedInstrument = { ...instrument, economicBasis: basis, state: 'ISSUED', status: 'ACTIVE', issuanceStatus: 'ISSUED', issuanceAuthorizationId: authorizationId, issuanceTransactionId: transaction.transactionId, valueReferenceArchitecture: vvr.mode === 'CANONICAL_VVR_REFERENCE' ? 'CANONICAL_VVR_REFERENCE' : instrument.valueReferenceArchitecture || 'LEGACY_VERIFIED_RECORD_REFERENCE', issueDate: transaction.issueDate, maturityDate: transaction.maturityDate, issuedBy: actorId, issuedAt, updatedAt: issuedAt };
    const consumedAuthorization = { ...authorization, status: 'CONSUMED', consumedAt: issuedAt, issuanceTransactionId: transaction.transactionId };
    const completedRequest = { ...request, status: 'ISSUED', issuedAt, transactionId: transaction.transactionId, canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || null, economicBasis: basis, updatedAt: issuedAt };
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, instrument.opportunityId);
    const lifecycle = { id: id('LE'), objectType: TYPES.SRA_INSTRUMENT, objectId: instrument.instrumentId, eventType: 'FUNDING_INSTRUMENT_ISSUED', actorId, payload: { issuanceAuthorizationId: authorizationId, transactionId: transaction.transactionId, faceValue: transaction.amount, currency: transaction.currency, canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || null, economicBasis: basis, marketplaceStatus: 'NOT_LISTED', onChainStatus: 'NOT_PROJECTED' }, occurredAt: issuedAt };
    const changes = [
      { type: TYPES.SRA_TRANSACTION, id: transaction.transactionId, payload: transaction, actorId, eventType: 'SRA_INSTRUMENT_ISSUANCE_RECORDED' },
      { type: TYPES.SRA_INSTRUMENT, id: instrument.instrumentId, payload: issuedInstrument, actorId, eventType: 'SRA_INSTRUMENT_ISSUED' },
      { type: TYPES.ISSUANCE_AUTHORIZATION, id: authorizationId, payload: consumedAuthorization, actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_AUTHORIZATION_CONSUMED' },
      { type: TYPES.ISSUANCE_REQUEST, id: request.issuanceRequestId, payload: completedRequest, actorId, eventType: 'FUNDING_INSTRUMENT_ISSUANCE_COMPLETED' },
      { type: TYPES.LIFECYCLE_EVENT, id: lifecycle.id, payload: lifecycle, actorId, eventType: lifecycle.eventType },
    ];
    if (opportunity) changes.push({ type: TYPES.OPPORTUNITY, id: opportunity.opportunityId, payload: { ...opportunity, status: 'INSTRUMENT_ISSUED', fundingPhase: 'MARKETPLACE_PREPARATION', issuanceTransactionId: transaction.transactionId, canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || opportunity.canonicalVerifiedValueRecordId || null, economicBasis: basis, updatedAt: issuedAt, history: [...(opportunity.history || []), { from: opportunity.status, to: 'INSTRUMENT_ISSUED', at: issuedAt, actorId, note: instrument.instrumentFamily }] }, actorId, eventType: 'FUNDING_OPPORTUNITY_INSTRUMENT_ISSUED' });
    await this.domain.atomicPut(changes);
    return { instrument: issuedInstrument, transaction };
  }
}

export { TYPES as FUNDING_INSTRUMENT_ISSUANCE_RECORD_TYPES };