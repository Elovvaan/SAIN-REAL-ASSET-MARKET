import test from 'node:test';
import assert from 'node:assert/strict';
import { FundingMarketplaceAllocationService } from '../services/funding-marketplace-allocation-service.js';

class FakeDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() {}
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  async put(type, id, payload) { this.records.set(this.key(type, id), payload); return payload; }
  async atomicPut(changes) { for (const change of changes) this.records.set(this.key(change.type, change.id), change.payload); }
}

function seed(domain) {
  domain.records.set('PARTICIPANT:P-1', { participantId: 'P-1', status: 'ACTIVE' });
  domain.records.set('MARKETPLACE_LISTING:ML-1', {
    listingId: 'ML-1', positionId: 'FP-1', distributionAuthorizationId: 'PDA-1',
    issuerParticipantId: 'ISSUER-1', transactionRouteId: 'TR-1', settlementRouteId: 'SR-1',
    restrictions: ['TRANSFER_SUBJECT_TO_SRA_RULES'], disclosures: ['POSITION_RISK_DISCLOSURE'],
  });
  domain.records.set('FUNDING_MARKETPLACE_POSITION:FMPOS-1', {
    positionId: 'FMPOS-1', financedPositionId: 'FP-1', distributionAuthorizationId: 'PDA-1', allocationReviewId: 'AR-1',
    commitmentId: 'C-1', windowId: 'W-1', listingId: 'ML-1', instrumentId: 'INST-1', opportunityId: 'OPP-1',
    participantId: 'P-1', quantity: 100, unitPrice: 10, totalAmount: 1000, currency: 'USD',
    ownershipStatus: 'PENDING_SETTLEMENT', status: 'CREATED', settlementStatus: 'NOT_STARTED', participationAgreementId: null,
  });
}

test('secondary participation agreement is required before settlement preparation', async () => {
  const domain = new FakeDomain();
  seed(domain);
  const service = new FundingMarketplaceAllocationService(domain);
  await service.initialize();

  await assert.rejects(
    () => service.prepareSettlement('FMPOS-1', { paymentSourceReference: 'SRC-1', destinationReference: 'DST-1' }, 'SRA-OPS'),
    /executed secondary participation agreement is required/i,
  );

  const agreement = await service.createParticipationAgreement('FMPOS-1', {}, 'SRA-OPS');
  assert.equal(agreement.financedPositionId, 'FP-1');
  assert.equal(agreement.participantId, 'P-1');
  assert.equal(agreement.transferorId, 'SRA');
  assert.equal(agreement.servicerId, 'SRA');
  assert.equal(agreement.financingDependency, 'NONE');
  assert.equal(agreement.guarantyStatus, 'NO_SRA_OR_GOVERNMENT_REPAYMENT_GUARANTY');
  assert.equal(agreement.underlyingObligationUnchanged, true);

  const accepted = await service.acceptParticipationAgreement(agreement.participationAgreementId, { accepted: true }, 'P-1');
  assert.equal(accepted.status, 'AWAITING_SRA_EXECUTION');
  assert.equal(accepted.participantAcceptanceStatus, 'ACCEPTED');

  const executed = await service.executeParticipationAgreement(agreement.participationAgreementId, { executed: true }, 'SRA-OPS');
  assert.equal(executed.status, 'EXECUTED');
  assert.equal(executed.sraExecutionStatus, 'EXECUTED');

  const preparation = await service.prepareSettlement('FMPOS-1', {
    paymentSourceReference: 'SRC-1', destinationReference: 'DST-1',
  }, 'SRA-OPS');

  assert.equal(preparation.participationAgreementId, agreement.participationAgreementId);
  assert.equal(preparation.financedPositionId, 'FP-1');
  assert.equal(preparation.participantId, 'P-1');
  assert.equal(preparation.status, 'PREPARED');
});

test('secondary participation workflow does not create or require a participant before financing exists', async () => {
  const domain = new FakeDomain();
  const service = new FundingMarketplaceAllocationService(domain);
  await service.initialize();

  assert.equal(service.listPositions({}).length, 0);
  assert.equal(service.listAgreements({}).length, 0);
  assert.equal(service.status().participationAgreements, 0);
});
