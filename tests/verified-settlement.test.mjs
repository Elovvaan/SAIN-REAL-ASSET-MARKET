import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { DatabaseService } from '../services/database-service.js';
import { PersistentDomainService } from '../services/persistent-domain-service.js';
import { FundingMarketplaceSettlementService } from '../services/funding-marketplace-settlement-service.js';
import { createFundingMarketplaceSettlementRouter } from '../routes/funding-marketplace-settlement-router.js';

async function fixture() {
  const database = new DatabaseService({ connectionString: '' });
  await database.initialize();
  const domain = new PersistentDomainService(database);
  const service = new FundingMarketplaceSettlementService(domain);
  const authorization = {
    settlementAuthorizationId: 'FMSA-TEST', settlementPreparationId: 'FMSP-TEST', positionId: 'FMPOS-TEST', opportunityId: 'FOP-TEST',
    participantId: 'BUYER', issuerParticipantId: 'ISSUER', amount: 1000, currency: 'USD', quantity: 10,
    transactionRouteId: 'TX-ROUTE', settlementRouteId: 'SETTLEMENT-ROUTE', paymentSourceReference: 'SOURCE-1', destinationReference: 'DEST-1',
    status: 'AWAITING_CONFIRMATION', verifiedConfirmationId: null, consumedAt: null,
  };
  await domain.atomicPut([
    { type: 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION', id: authorization.settlementAuthorizationId, payload: authorization, audit: false },
    { type: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION', id: 'FMSP-TEST', payload: { settlementPreparationId:'FMSP-TEST', positionId:'FMPOS-TEST', opportunityId:'FOP-TEST', status:'AUTHORIZED', settlementStatus:'AWAITING_CONFIRMATION' }, audit:false },
    { type: 'FUNDING_MARKETPLACE_POSITION', id: 'FMPOS-TEST', payload: { positionId:'FMPOS-TEST', commitmentId:'FMC-TEST', listingId:'LIST-TEST', instrumentId:'INS-TEST', opportunityId:'FOP-TEST', participantId:'BUYER', ownershipStatus:'PENDING_SETTLEMENT', settlementStatus:'NOT_STARTED', status:'SETTLEMENT_PREPARED', totalAmount:1000, currency:'USD', quantity:10 }, audit:false },
    { type: 'FUNDING_OPPORTUNITY', id: 'FOP-TEST', payload: { opportunityId:'FOP-TEST', status:'ALLOCATION_CREATED', fundingPhase:'SETTLEMENT_PREPARATION', history:[] }, audit:false },
    { type: 'LEDGER_ENTRY', id: 'LEDGER-SETTLED', payload: { entryId:'LEDGER-SETTLED', status:'POSTED', amount:1000, currency:'USD' }, audit:false },
  ]);
  return { database, domain, service, authorization };
}

function confirmationInput(overrides = {}) {
  return {
    sourceType:'EXTERNAL_RAIL', providerId:'TEST_BANK', providerReference:'BANK-REF-1', networkReference:'NETWORK-1',
    amount:1000, currency:'USD', paymentSourceReference:'SOURCE-1', destinationReference:'DEST-1', providerStatus:'SETTLED',
    confirmedAt:'2026-08-05T12:00:00.000Z', rawEvidence:{ signed:true }, ...overrides,
  };
}

test('ownership recognition is denied without verified settlement confirmation', async () => {
  const { service } = await fixture();
  await assert.rejects(() => service.settle('FMSA-TEST', {}, 'STAFF'), (error) => error.code === 'VERIFIED_SETTLEMENT_CONFIRMATION_REQUIRED');
});

test('matching external confirmation can be verified and consumed for ownership', async () => {
  const { service, domain } = await fixture();
  const confirmation = await service.registerConfirmation('FMSA-TEST', confirmationInput(), 'CONNECTOR:TEST_BANK');
  assert.equal(confirmation.status, 'RECEIVED');
  const verified = await service.verifyConfirmation(confirmation.settlementConfirmationId, 'SETTLEMENT_OPERATOR');
  assert.equal(verified.status, 'VERIFIED');
  const result = await service.settle('FMSA-TEST', {}, 'SETTLEMENT_OPERATOR');
  assert.equal(result.position.ownershipStatus, 'RECOGNIZED');
  assert.equal(result.transaction.externalSettlementReference, 'BANK-REF-1');
  assert.equal(domain.get('FUNDING_MARKETPLACE_SETTLEMENT_CONFIRMATION', confirmation.settlementConfirmationId).status, 'CONSUMED');
});

test('mismatched confirmation is rejected and cannot authorize settlement', async () => {
  const { service } = await fixture();
  const confirmation = await service.registerConfirmation('FMSA-TEST', confirmationInput({ amount:999 }), 'CONNECTOR:TEST_BANK');
  assert.equal(confirmation.status, 'REJECTED');
  await assert.rejects(() => service.verifyConfirmation(confirmation.settlementConfirmationId, 'STAFF'));
  await assert.rejects(() => service.settle('FMSA-TEST', {}, 'STAFF'), (error) => error.code === 'VERIFIED_SETTLEMENT_CONFIRMATION_REQUIRED');
});

test('internal ledger confirmation requires an existing settled ledger record', async () => {
  const { service } = await fixture();
  await assert.rejects(() => service.registerConfirmation('FMSA-TEST', confirmationInput({ sourceType:'INTERNAL_LEDGER', ledgerEntryId:'MISSING' }), 'STAFF'));
  const confirmation = await service.registerConfirmation('FMSA-TEST', confirmationInput({ sourceType:'INTERNAL_LEDGER', ledgerEntryId:'LEDGER-SETTLED', providerReference:'LEDGER-SETTLED' }), 'STAFF');
  assert.equal(confirmation.status, 'RECEIVED');
});

test('reversal before settlement reopens authorization and blocks ownership', async () => {
  const { service, domain } = await fixture();
  const confirmation = await service.registerConfirmation('FMSA-TEST', confirmationInput(), 'CONNECTOR:TEST_BANK');
  await service.verifyConfirmation(confirmation.settlementConfirmationId, 'STAFF');
  await service.recordReversal(confirmation.settlementConfirmationId, { reversalReference:'RETURN-1', reason:'Bank returned payment.' }, 'STAFF');
  assert.equal(domain.get('FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION', 'FMSA-TEST').status, 'AWAITING_CONFIRMATION');
  await assert.rejects(() => service.settle('FMSA-TEST', {}, 'STAFF'), (error) => error.code === 'VERIFIED_SETTLEMENT_CONFIRMATION_REQUIRED');
});

test('external callback requires connector authentication', async () => {
  const previous = process.env.SRA_SETTLEMENT_CONNECTOR_KEY;
  process.env.SRA_SETTLEMENT_CONNECTOR_KEY = 'connector-secret';
  const fakeService = { registerConfirmation: async (_id, input, actor) => ({ input, actor }) };
  const app = express(); app.use(express.json()); app.use('/api/funding-marketplace-settlement', createFundingMarketplaceSettlementRouter(fakeService));
  await request(app).post('/api/funding-marketplace-settlement/confirmations/external').send({ settlementAuthorizationId:'FMSA-1' }).expect(401);
  const accepted = await request(app).post('/api/funding-marketplace-settlement/confirmations/external').set('x-sra-settlement-connector-key','connector-secret').send({ settlementAuthorizationId:'FMSA-1', providerId:'BANK' }).expect(201);
  assert.equal(accepted.body.actor, 'CONNECTOR:BANK');
  if (previous == null) delete process.env.SRA_SETTLEMENT_CONNECTOR_KEY; else process.env.SRA_SETTLEMENT_CONNECTOR_KEY = previous;
});
