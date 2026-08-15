import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { FundingOpportunityIntakeService } from '../services/funding-opportunity-intake-service.js';
import { FinancingLifecycleService } from '../services/financing-lifecycle-service.js';
import { createFundingOpportunityRouter } from '../routes/funding-opportunity-router.js';

class MemoryDomain {
  constructor() {
    this.records = new Map();
    this.events = [];
    this.database = null;
  }

  key(type, id) { return `${type}:${id}`; }
  async hydrate() {}
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  }
  async put(type, id, record) {
    this.records.set(this.key(type, id), structuredClone(record));
    return record;
  }
  async lifecycle(event) { this.events.push(structuredClone(event)); }
}

async function setup() {
  const domain = new MemoryDomain();
  await domain.put('PARTICIPANT', 'P-LOC', { id: 'P-LOC', displayName: 'LOC Test', type: 'ORGANIZATION' });
  const service = new FundingOpportunityIntakeService(domain);
  await service.initialize();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sraOperationsAuth = { roles: ['PLATFORM_ADMIN'], source: 'TEST' };
    req.sraIdentity = { actorId: 'USR-ADMIN' };
    next();
  });
  app.use('/api/funding', createFundingOpportunityRouter(service));
  return { app, domain, service };
}

test('line of credit uses the requested and approved limits instead of a hard-coded amount', async () => {
  const { app, domain, service } = await setup();

  const createdResponse = await request(app)
    .post('/api/funding/opportunities')
    .send({
      applicantParticipantId: 'P-LOC',
      title: 'Operating line',
      opportunityType: 'LINE_OF_CREDIT',
      purpose: 'WORKING_CAPITAL',
      requestedAmount: 50000,
      currency: 'USD',
    })
    .expect(201);

  const opportunityId = createdResponse.body.opportunityId;
  assert.equal(createdResponse.body.creditFacility.requestedLimit, 50000);
  assert.equal(createdResponse.body.creditFacility.availableCredit, 0);

  const intake = service.get(opportunityId);
  await domain.put('FUNDING_OPPORTUNITY', opportunityId, { ...intake, financingStage: 'UNDERWRITING', status: 'INTAKE_COMPLETE' });

  const underwritingResponse = await request(app)
    .post(`/api/funding/opportunities/${opportunityId}/underwriting`)
    .send({ recommendedAmount: 40000, conclusion: 'Facility supported for testing.' })
    .expect(200);
  assert.equal(underwritingResponse.body.opportunity.financingStage, 'DECISION');

  const decisionResponse = await request(app)
    .post(`/api/funding/opportunities/${opportunityId}/credit-decision`)
    .send({ decision: 'APPROVE', approvedAmount: 35000, rationale: 'Approved test facility.' })
    .expect(200);
  assert.equal(decisionResponse.body.opportunity.creditFacility.approvedLimit, 35000);
  assert.equal(decisionResponse.body.opportunity.creditFacility.availableCredit, 35000);
  assert.equal(decisionResponse.body.opportunity.financingStage, 'CLOSING');

  const lifecycle = new FinancingLifecycleService(domain);
  await lifecycle.transition(opportunityId, 'READY_TO_FUND', { source: 'TEST_CLOSING_COMPLETE' }, 'USR-ADMIN');

  const firstDraw = await request(app)
    .post(`/api/funding/opportunities/${opportunityId}/line-of-credit/draws`)
    .send({ amount: 12500, settlementReference: 'SETTLEMENT-001' })
    .expect(201);
  assert.equal(firstDraw.body.opportunity.financingStage, 'FUNDED');
  assert.equal(firstDraw.body.facility.outstandingPrincipal, 12500);
  assert.equal(firstDraw.body.facility.availableCredit, 22500);

  const repayment = await request(app)
    .post(`/api/funding/opportunities/${opportunityId}/line-of-credit/repayments`)
    .send({ amount: 2500, settlementReference: 'REPAYMENT-001' })
    .expect(201);
  assert.equal(repayment.body.facility.outstandingPrincipal, 10000);
  assert.equal(repayment.body.facility.availableCredit, 25000);

  const secondDraw = await request(app)
    .post(`/api/funding/opportunities/${opportunityId}/line-of-credit/draws`)
    .send({ amount: 5000, settlementReference: 'SETTLEMENT-002' })
    .expect(201);
  assert.equal(secondDraw.body.facility.outstandingPrincipal, 15000);
  assert.equal(secondDraw.body.facility.availableCredit, 20000);

  await request(app)
    .post(`/api/funding/opportunities/${opportunityId}/line-of-credit/draws`)
    .send({ amount: 20001, settlementReference: 'SETTLEMENT-OVERLIMIT' })
    .expect(400);
});
