import test from 'node:test';
import assert from 'node:assert/strict';
import { FundingInstrumentReviewService } from '../services/funding-instrument-review-service.js';
import { FundingInstrumentIssuanceService } from '../services/funding-instrument-issuance-service.js';
import { DETERMINATION_RECORD_TYPES } from '../services/determination-engine-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() { return {}; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async atomicPut(changes = []) { for (const change of changes) await this.put(change.type, change.id, change.payload); return changes.map((change) => structuredClone(change.payload)); }
  async lifecycle() { return {}; }
}

const INSTRUMENT = 'SRA_INSTRUMENT';
const OPPORTUNITY = 'FUNDING_OPPORTUNITY';

test('canonical VVR economic basis survives review, authorization, and issuance', async () => {
  const domain = new MemoryDomain();
  await domain.put(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, 'VVR-1', {
    verifiedValueRecordId: 'VVR-1', state: 'CANONICAL', immutable: true, permittedUses: ['CONTRACT_REFERENCE'], value: 100000, currency: 'USD', determinationId: 'DET-1', snapshotId: 'SNP-1',
  });
  await domain.put(OPPORTUNITY, 'FO-1', { opportunityId: 'FO-1', status: 'INSTRUMENT_DRAFTED', history: [] });
  await domain.put(INSTRUMENT, 'SRAI-1', {
    instrumentId: 'SRAI-1', state: 'DRAFT', status: 'DRAFT', issuanceStatus: 'NOT_ISSUED', instrumentFamily: 'TRUE_BILL', fundingModel: 'PROJECT_FUNDING', opportunityId: 'FO-1', issuerParticipantId: 'P-1', verifiedRecordId: 'FVRD-1', purpose: 'PROJECT FUNDING',
    requestedAmount: 80000, recognizedReferenceValue: 100000, recognizedReferenceCurrency: 'USD', faceValue: 75000, faceValueBasis: 'EXPLICIT_STRUCTURING_DECISION', currency: 'USD', transferabilityStatus: 'RESTRICTED', settlementRule: 'NET', governingDocumentId: 'DOC-1', maturityDate: '2027-08-07', denomination: 1000, verifiedValuePackageId: 'VVP-1',
    canonicalVerifiedValueRecordId: 'VVR-1', referencedDeterminationId: 'DET-1', referencedSnapshotId: 'SNP-1', valueReferenceArchitecture: 'CANONICAL_VVR_REFERENCE',
  });

  const reviewService = new FundingInstrumentReviewService(domain);
  await reviewService.initialize();
  const review = await reviewService.startReview('SRAI-1', {}, 'REVIEWER-1');
  assert.equal(review.economicBasis.requestedAmount, 80000);
  assert.equal(review.economicBasis.recognizedReferenceValue, 100000);
  assert.equal(review.economicBasis.faceValue, 75000);
  assert.equal(review.economicBasis.faceValueVarianceFromRecognized, -25000);

  for (const check of review.reviewScope) {
    await reviewService.recordFinding(review.reviewId, { checkType: check, result: 'PASS' }, 'REVIEWER-1');
  }
  await reviewService.decide(review.reviewId, { decision: 'APPROVED_FOR_ISSUANCE_REQUEST' }, 'REVIEWER-1');
  const request = await reviewService.createIssuanceRequest(review.reviewId, {}, 'REVIEWER-1');
  assert.equal(request.canonicalVerifiedValueRecordId, 'VVR-1');
  assert.equal(request.requestedToRecognizedRatio, 0.8);
  assert.equal(request.faceValueToRecognizedRatio, 0.75);

  const issuanceService = new FundingInstrumentIssuanceService(domain);
  await issuanceService.initialize();
  const issuanceReview = await issuanceService.startReview(request.issuanceRequestId, {}, 'ISSUER-1');
  assert.equal(issuanceReview.economicBasis.faceValueVarianceFromRecognized, -25000);
  const decision = await issuanceService.decide(issuanceReview.issuanceReviewId, { decision: 'AUTHORIZED' }, 'ISSUER-1');
  assert.equal(decision.authorization.recognizedReferenceValue, 100000);
  assert.equal(decision.authorization.authorizedFaceValue, 75000);
  assert.equal(decision.authorization.referencedDeterminationId, 'DET-1');
  const issued = await issuanceService.issue(decision.authorization.issuanceAuthorizationId, {}, 'ISSUER-1');
  assert.equal(issued.transaction.economicBasis.requestedAmount, 80000);
  assert.equal(issued.transaction.economicBasis.recognizedReferenceValue, 100000);
  assert.equal(issued.transaction.economicBasis.faceValue, 75000);
  assert.equal(issued.transaction.canonicalVerifiedValueRecordId, 'VVR-1');
  assert.equal(issued.transaction.referencedSnapshotId, 'SNP-1');
});
