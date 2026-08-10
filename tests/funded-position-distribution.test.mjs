import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancingClosingService } from '../services/financing-closing-service.js';
import { FinancedPositionDistributionService } from '../services/financed-position-distribution-service.js';
import { FundingMarketplacePreparationService } from '../services/funding-marketplace-preparation-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() { return {}; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value); }
  async put(type, id, payload) { this.records.set(this.key(type, id), payload); return payload; }
  async atomicPut(changes) { for (const change of changes) this.records.set(this.key(change.type, change.id), change.payload); return changes.map((change) => change.payload); }
  async lifecycle(event) { this.events.push(event); return event; }
}

function seed(domain) {
  domain.records.set(domain.key(RECORD_TYPES.SRA_TRANSACTION, 'LFA-1'), {
    transactionId: 'LFA-1', transactionType: 'LOAN_FINANCING_AUTHORIZATION', state: 'POSTED', status: 'FUNDING_CREDITED_PENDING_DISBURSEMENT',
    issuanceTransactionId: 'ISSUE-TX-1', instrumentId: 'INS-1', opportunityId: 'FOR-1', borrowerParticipantId: 'P-BORROWER', amount: 500000, currency: 'USD',
  });
  domain.records.set(domain.key('SRA_INSTRUMENT', 'INS-1'), {
    instrumentId: 'INS-1', opportunityId: 'FOR-1', issuerParticipantId: 'SRA', instrumentFamily: 'LOAN', state: 'ISSUED', issuanceStatus: 'ISSUED', issuanceTransactionId: 'ISSUE-TX-1',
    faceValue: 500000, currency: 'USD', purpose: 'Business acquisition', transferabilityStatus: 'TRANSFERABLE', settlementRule: 'SETTLEMENT_REQUIRED', governingDocumentId: 'DOC-1', restrictions: [],
  });
  domain.records.set(domain.key('FINANCING_CLOSING', 'FCL-1'), {
    closingId: 'FCL-1', financingTransactionId: 'LFA-1', issuanceTransactionId: 'ISSUE-TX-1', instrumentId: 'INS-1', opportunityId: 'FOR-1', borrowerParticipantId: 'P-BORROWER',
    approvedAmount: 500000, finalFundingAmount: 500000, currency: 'USD', status: 'AUTHORIZED',
  });
  domain.records.set(domain.key('FINANCING_DISBURSEMENT', 'FDB-1'), {
    disbursementId: 'FDB-1', closingId: 'FCL-1', financingTransactionId: 'LFA-1', opportunityId: 'FOR-1', instrumentId: 'INS-1', amount: 500000, currency: 'USD', status: 'SUBMITTED', settlementMethod: 'FEDWIRE',
  });
}

test('financing settlement creates an SRA-owned position without any participant commitment', async () => {
  const domain = new Domain(); seed(domain);
  const closing = new FinancingClosingService(domain); await closing.initialize();
  const result = await closing.recordSettlement('FCL-1', 'FDB-1', { externalReference: 'SETTLEMENT-001' }, 'ADMIN');
  assert.equal(result.financing.status, 'FUNDED');
  assert.equal(result.financedPosition.ownerId, 'SRA');
  assert.equal(result.financedPosition.currentPrincipal, 500000);
  assert.equal(result.financedPosition.retainedAmount, 500000);
  assert.equal(result.financedPosition.availableAmount, 0);
  assert.equal(result.financedPosition.distributionStatus, 'RETAINED');
  assert.equal(domain.list('FUNDING_MARKETPLACE_COMMITMENT').length, 0);
});

test('SRA may make only part of a funded position available after financing', async () => {
  const domain = new Domain(); seed(domain);
  const closing = new FinancingClosingService(domain); await closing.initialize();
  const funded = await closing.recordSettlement('FCL-1', 'FDB-1', { externalReference: 'SETTLEMENT-001' }, 'ADMIN');
  const distribution = new FinancedPositionDistributionService(domain); await distribution.initialize();
  const result = await distribution.makeAvailable(funded.financedPosition.positionId, { offeredAmount: 200000 }, 'ADMIN');
  assert.equal(result.authorization.offeringMode, 'PARTIAL_OFFER');
  assert.equal(result.authorization.offeredAmount, 200000);
  assert.equal(result.position.retainedAmount, 300000);
  assert.equal(result.position.availableAmount, 200000);
  assert.equal(result.position.distributionStatus, 'AVAILABLE');
});

test('marketplace preparation requires funded position plus distribution authorization', async () => {
  const domain = new Domain(); seed(domain);
  const closing = new FinancingClosingService(domain); await closing.initialize();
  const funded = await closing.recordSettlement('FCL-1', 'FDB-1', { externalReference: 'SETTLEMENT-001' }, 'ADMIN');
  const distribution = new FinancedPositionDistributionService(domain); await distribution.initialize();
  const market = new FundingMarketplacePreparationService(domain); await market.initialize();
  assert.equal(market.assessInstrument('INS-1').eligibleForMarketplacePreparation, false);
  await assert.rejects(() => market.createPreparation(funded.financedPosition.positionId, {}, 'ADMIN'), /distributionAuthorizationId is required/);
  const available = await distribution.makeAvailable(funded.financedPosition.positionId, { offeredAmount: 200000 }, 'ADMIN');
  const preparation = await market.createPreparation(funded.financedPosition.positionId, {
    distributionAuthorizationId: available.authorization.distributionAuthorizationId,
    offeredQuantity: 200000,
    pricing: { method: 'ASK', askingPrice: 1 },
    accessRules: { eligibilityRule: 'ELIGIBLE_PARTICIPANTS', minimumOrder: 1000 },
    transactionRouteId: 'TX-ROUTE', settlementRouteId: 'SETTLEMENT-ROUTE', disclosures: ['Position transfer disclosure'],
  }, 'ADMIN');
  assert.equal(preparation.positionId, funded.financedPosition.positionId);
  assert.equal(domain.get('FINANCED_POSITION', funded.financedPosition.positionId).distributionStatus, 'IN_MARKET');
});

test('non-transferable instruments cannot be made available', async () => {
  const domain = new Domain(); seed(domain);
  domain.records.set(domain.key('SRA_INSTRUMENT', 'INS-1'), { ...domain.get('SRA_INSTRUMENT', 'INS-1'), transferabilityStatus: 'NON_TRANSFERABLE' });
  const closing = new FinancingClosingService(domain); await closing.initialize();
  const funded = await closing.recordSettlement('FCL-1', 'FDB-1', { externalReference: 'SETTLEMENT-001' }, 'ADMIN');
  const distribution = new FinancedPositionDistributionService(domain); await distribution.initialize();
  await assert.rejects(() => distribution.makeAvailable(funded.financedPosition.positionId, { offeredAmount: 200000 }, 'ADMIN'), /not eligible for distribution/);
});