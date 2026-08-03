import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

const actor = { 'x-sra-actor-id': 'CUSTOMER-TEST-001' };

test('home project moves from verified package through approved funding and settlement', async () => {
  const { app } = await createApp({ serveStatic: false, seedMarketplace: false });

  const created = await request(app)
    .post('/api/financing/home-projects')
    .set(actor)
    .send({
      customerId: 'CUSTOMER-001',
      title: 'Primary Residence Purchase',
      property: { address: '100 Verified Way, Ogden, Utah', propertyType: 'RESIDENTIAL' },
      purchasePrice: 400000,
      verifiedBuyerFunds: 80000,
      targetClosingDate: '2026-09-30'
    })
    .expect(201);

  const homeProjectId = created.body.homeProjectId;
  assert.equal(created.body.fundingNeeded, 320000);
  assert.equal(created.body.state, 'DRAFT');

  await request(app)
    .post(`/api/financing/home-projects/${homeProjectId}/transition`)
    .set(actor)
    .send({ state: 'DATA_COLLECTION' })
    .expect(200);

  await request(app)
    .put(`/api/financing/home-projects/${homeProjectId}`)
    .set(actor)
    .send({ snapshotId: 'EDX-VS-TEST', valuePackageId: 'EDX-VVP-TEST' })
    .expect(200);

  await request(app)
    .post(`/api/financing/home-projects/${homeProjectId}/transition`)
    .set(actor)
    .send({ state: 'PACKAGE_READY' })
    .expect(200);

  const planResponse = await request(app)
    .post('/api/financing/funding-plans')
    .set(actor)
    .send({
      homeProjectId,
      settlementInstructionsReference: 'SETTLEMENT-INSTRUCTIONS-001',
      sources: [
        { type: 'BUYER_FUNDS', amount: 80000, status: 'VERIFIED' },
        { type: 'INSTITUTION_FINANCING', providerId: 'INSTITUTION-001', instrumentId: 'HOME-INSTRUMENT-001', amount: 320000, status: 'PROPOSED' }
      ],
      postSettlementObligations: [
        { obligationType: 'PAYMENT_PERFORMANCE', instrumentId: 'HOME-INSTRUMENT-001' }
      ]
    })
    .expect(201);

  const fundingPlanId = planResponse.body.fundingPlanId;
  assert.equal(planResponse.body.totalPlanned, 400000);
  assert.equal(planResponse.body.remainingGap, 0);

  await request(app)
    .post(`/api/financing/funding-plans/${fundingPlanId}/transition`)
    .set(actor)
    .send({ state: 'READY_FOR_REVIEW' })
    .expect(200);

  await request(app)
    .post(`/api/financing/funding-plans/${fundingPlanId}/transition`)
    .set(actor)
    .send({ state: 'CUSTOMER_APPROVED', customerApprovalReference: 'CUSTOMER-APPROVAL-001' })
    .expect(200);

  await request(app)
    .post(`/api/financing/funding-plans/${fundingPlanId}/transition`)
    .set(actor)
    .send({ state: 'COMMITTED' })
    .expect(200);

  await request(app)
    .post(`/api/financing/funding-plans/${fundingPlanId}/transition`)
    .set(actor)
    .send({ state: 'SETTLEMENT_READY' })
    .expect(200);

  await request(app)
    .post(`/api/financing/home-projects/${homeProjectId}/transition`)
    .set(actor)
    .send({ state: 'SETTLEMENT_READY' })
    .expect(200);

  await request(app)
    .post(`/api/financing/funding-plans/${fundingPlanId}/transition`)
    .set(actor)
    .send({ state: 'SETTLED' })
    .expect(200);

  const settledProject = await request(app)
    .post(`/api/financing/home-projects/${homeProjectId}/transition`)
    .set(actor)
    .send({ state: 'SETTLED', settlementReference: 'CLOSING-001' })
    .expect(200);

  assert.equal(settledProject.body.state, 'SETTLED');
  assert.equal(settledProject.body.settlementReference, 'CLOSING-001');

  const workspace = await request(app)
    .get(`/api/financing/home-projects/${homeProjectId}/workspace`)
    .expect(200);

  assert.equal(workspace.body.homeProject.state, 'SETTLED');
  assert.equal(workspace.body.fundingPlan.state, 'SETTLED');
  assert.equal(workspace.body.financingSummary.remainingGap, 0);
  assert.equal(workspace.body.financingSummary.nextAction, 'CONVERT_TO_ONGOING_ASSET_RECORD');
});

test('funding plan cannot enter review while a funding gap remains', async () => {
  const { app } = await createApp({ serveStatic: false, seedMarketplace: false });

  const project = await request(app)
    .post('/api/financing/home-projects')
    .set(actor)
    .send({ customerId: 'CUSTOMER-002', property: { address: '200 Gap Street, Ogden, Utah' }, purchasePrice: 300000, verifiedBuyerFunds: 50000 })
    .expect(201);

  await request(app).post(`/api/financing/home-projects/${project.body.homeProjectId}/transition`).set(actor).send({ state: 'DATA_COLLECTION' }).expect(200);
  await request(app).put(`/api/financing/home-projects/${project.body.homeProjectId}`).set(actor).send({ snapshotId: 'VS-2', valuePackageId: 'VVP-2' }).expect(200);
  await request(app).post(`/api/financing/home-projects/${project.body.homeProjectId}/transition`).set(actor).send({ state: 'PACKAGE_READY' }).expect(200);

  const plan = await request(app)
    .post('/api/financing/funding-plans')
    .set(actor)
    .send({
      homeProjectId: project.body.homeProjectId,
      sources: [
        { type: 'BUYER_FUNDS', amount: 50000 },
        { type: 'INSTITUTION_FINANCING', amount: 200000 }
      ]
    })
    .expect(201);

  assert.equal(plan.body.remainingGap, 50000);

  const blocked = await request(app)
    .post(`/api/financing/funding-plans/${plan.body.fundingPlanId}/transition`)
    .set(actor)
    .send({ state: 'READY_FOR_REVIEW' })
    .expect(400);

  assert.match(blocked.body.error, /uncovered funding gap/i);
});
