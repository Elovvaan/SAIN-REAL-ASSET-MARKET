import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TreasuryFinancingCapacityService } from '../services/treasury-financing-capacity-service.js';
import { FundingMarketplaceSettlementService } from '../services/funding-marketplace-settlement-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type,id) { return `${type}:${id}`; }
  get(type,id) { return structuredClone(this.records.get(this.key(type,id)) || null); }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([,value]) => structuredClone(value)); }
  async put(type,id,payload) { this.records.set(this.key(type,id), structuredClone(payload)); }
  async atomicPut(changes) { for (const change of changes) this.records.set(this.key(change.type,change.id), structuredClone(change.payload)); }
  async hydrate() {}
}

async function seedCapacity(domain, amount = 18_000_000) {
  await domain.put('SRA_TRANSACTION','PFID-1',{
    transactionId:'PFID-1', transactionType:'PLATFORM_FUNDING_INSTRUMENT_DEPOSIT',
    isCanonicalPlatformFundingInstrument:true, state:'DEPOSITED_RECOGNIZED_USD', faceValueUsd:amount,
  });
}

test('Treasury financing capacity separates total, held, deployed, and remaining capacity', async () => {
  const domain = new Domain();
  await seedCapacity(domain, 18_000_000);
  await domain.put('FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION','AUTH-HOLD',{
    settlementAuthorizationId:'AUTH-HOLD', paymentSourceReference:'SRA_PLATFORM_TREASURY', amount:100_000,
    status:'AWAITING_CONFIRMATION', consumedAt:null,
  });
  await domain.put('FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION','AUTH-DEPLOYED',{
    settlementAuthorizationId:'AUTH-DEPLOYED', paymentSourceReference:'SRA_PLATFORM_TREASURY', amount:250_000,
    status:'CONSUMED', consumedAt:'2026-08-08T15:00:00.000Z',
  });
  await domain.put('SRA_TRANSACTION','SETTLED-1',{
    transactionId:'SETTLED-1', transactionType:'MARKETPLACE_SETTLEMENT', settlementAuthorizationId:'AUTH-DEPLOYED',
    paymentSourceReference:'SRA_PLATFORM_TREASURY', amount:250_000, status:'SETTLED', state:'RECORDED',
  });
  const summary = new TreasuryFinancingCapacityService(domain).summary();
  assert.equal(summary.totalFundingCapacityUsd,18_000_000);
  assert.equal(summary.committedFinancingUsd,100_000);
  assert.equal(summary.deployedFinancingUsd,250_000);
  assert.equal(summary.usedFinancingCapacityUsd,350_000);
  assert.equal(summary.availableFinancingCapacityUsd,17_650_000);
});

test('participant-funded settlements do not consume platform Treasury financing capacity', async () => {
  const domain = new Domain();
  await seedCapacity(domain, 18_000_000);
  await domain.put('FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION','AUTH-PARTICIPANT',{
    settlementAuthorizationId:'AUTH-PARTICIPANT', paymentSourceReference:'PARTICIPANT-VAULT-1', amount:500_000,
    status:'AWAITING_CONFIRMATION', consumedAt:null,
  });
  const summary = new TreasuryFinancingCapacityService(domain).summary();
  assert.equal(summary.committedFinancingUsd,0);
  assert.equal(summary.availableFinancingCapacityUsd,18_000_000);
});

test('Treasury-sourced settlement authorization cannot exceed remaining financing capacity', async () => {
  const domain = new Domain();
  await seedCapacity(domain, 100);
  await domain.put('FUNDING_MARKETPLACE_POSITION','POS-1',{
    positionId:'POS-1', ownershipStatus:'PENDING_SETTLEMENT', settlementStatus:'NOT_STARTED', status:'SETTLEMENT_PREPARED',
  });
  await domain.put('FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION','PREP-1',{
    settlementPreparationId:'PREP-1', positionId:'POS-1', opportunityId:'OPP-1', participantId:'BUYER', issuerParticipantId:'ISSUER',
    amount:125, currency:'USD', quantity:125, transactionRouteId:'TX', settlementRouteId:'SET',
    paymentSourceReference:'SRA_PLATFORM_TREASURY', destinationReference:'DEST', status:'PREPARED', settlementStatus:'NOT_STARTED',
  });
  await domain.put('FUNDING_MARKETPLACE_SETTLEMENT_REVIEW','REV-1',{
    settlementReviewId:'REV-1', settlementPreparationId:'PREP-1', status:'IN_REVIEW',
  });
  const service = new FundingMarketplaceSettlementService(domain);
  await assert.rejects(() => service.decide('REV-1',{decision:'AUTHORIZED'},'ADMIN'), (error) => error.code === 'TREASURY_FINANCING_CAPACITY_INSUFFICIENT');
  assert.equal(domain.list('FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION').length,0);
});

test('Treasury-sourced authorization immediately reserves capacity', async () => {
  const domain = new Domain();
  await seedCapacity(domain, 1000);
  await domain.put('FUNDING_MARKETPLACE_POSITION','POS-1',{
    positionId:'POS-1', ownershipStatus:'PENDING_SETTLEMENT', settlementStatus:'NOT_STARTED', status:'SETTLEMENT_PREPARED',
  });
  await domain.put('FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION','PREP-1',{
    settlementPreparationId:'PREP-1', positionId:'POS-1', opportunityId:'OPP-1', participantId:'BUYER', issuerParticipantId:'ISSUER',
    amount:125, currency:'USD', quantity:125, transactionRouteId:'TX', settlementRouteId:'SET',
    paymentSourceReference:'SRA_PLATFORM_TREASURY', destinationReference:'DEST', status:'PREPARED', settlementStatus:'NOT_STARTED',
  });
  await domain.put('FUNDING_MARKETPLACE_SETTLEMENT_REVIEW','REV-1',{
    settlementReviewId:'REV-1', settlementPreparationId:'PREP-1', status:'IN_REVIEW',
  });
  const service = new FundingMarketplaceSettlementService(domain);
  const result = await service.decide('REV-1',{decision:'AUTHORIZED'},'ADMIN');
  assert.equal(result.authorization.treasuryCapacitySource,'SRA_PLATFORM_TREASURY');
  const summary = new TreasuryFinancingCapacityService(domain).summary();
  assert.equal(summary.committedFinancingUsd,125);
  assert.equal(summary.availableFinancingCapacityUsd,875);
});

test('Treasury workstation presents managed financing capacity states', () => {
  const ui = fs.readFileSync(new URL('../public/admin/admin-treasury-workstation.js', import.meta.url),'utf8');
  const routes = fs.readFileSync(new URL('../routes/treasury-admin-routes.js', import.meta.url),'utf8');
  assert.match(ui,/Financing held/);
  assert.match(ui,/Financing deployed/);
  assert.match(ui,/Remaining capacity/);
  assert.match(ui,/Held for authorized financing/);
  assert.match(routes,/\/api\/admin\/treasury\/financing-capacity/);
  assert.match(routes,/committedFinancingUsd/);
  assert.match(routes,/deployedFinancingUsd/);
});
