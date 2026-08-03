import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

const actor = { 'x-sra-actor-id': 'SRA-SETTLEMENT-OPERATOR' };

async function createSettlementReadyProject(app) {
  const project = await request(app)
    .post('/api/financing/home-projects')
    .set(actor)
    .send({
      customerId: 'CUSTOMER-SETTLEMENT-001',
      title: 'Settlement Test Home',
      property: { address: '300 Settlement Avenue, Ogden, Utah', propertyType: 'RESIDENTIAL', parcelId: 'PARCEL-300', sellerId: 'SELLER-001' },
      purchasePrice: 400000,
      verifiedBuyerFunds: 80000,
      targetClosingDate: '2026-10-15'
    })
    .expect(201);

  const homeProjectId = project.body.homeProjectId;
  await request(app).post(`/api/financing/home-projects/${homeProjectId}/transition`).set(actor).send({ state: 'DATA_COLLECTION' }).expect(200);
  await request(app).put(`/api/financing/home-projects/${homeProjectId}`).set(actor).send({ snapshotId: 'EDX-VS-SETTLEMENT', valuePackageId: 'EDX-VVP-SETTLEMENT', participantIds: ['SELLER-001', 'TITLE-001'], documentReferences: ['PURCHASE-CONTRACT-001', 'TITLE-PACKAGE-001'] }).expect(200);
  await request(app).post(`/api/financing/home-projects/${homeProjectId}/transition`).set(actor).send({ state: 'PACKAGE_READY' }).expect(200);

  const plan = await request(app)
    .post('/api/financing/funding-plans')
    .set(actor)
    .send({
      homeProjectId,
      settlementInstructionsReference: 'SETTLEMENT-INSTRUCTIONS-001',
      sources: [
        { type: 'BUYER_FUNDS', amount: 80000, status: 'VERIFIED' },
        { type: 'PARTICIPATION_CAPITAL', providerId: 'INSTITUTION-A', instrumentId: 'PARTICIPATION-A', amount: 100000, status: 'COMMITTED' },
        { type: 'PARTICIPATION_CAPITAL', providerId: 'INSTITUTION-B', instrumentId: 'PARTICIPATION-B', amount: 220000, status: 'COMMITTED' }
      ]
    })
    .expect(201);

  const fundingPlanId = plan.body.fundingPlanId;
  await request(app).post(`/api/financing/funding-plans/${fundingPlanId}/transition`).set(actor).send({ state: 'READY_FOR_REVIEW' }).expect(200);
  await request(app).post(`/api/financing/funding-plans/${fundingPlanId}/transition`).set(actor).send({ state: 'CUSTOMER_APPROVED', customerApprovalReference: 'CUSTOMER-APPROVAL-SETTLEMENT' }).expect(200);
  await request(app).post(`/api/financing/funding-plans/${fundingPlanId}/transition`).set(actor).send({ state: 'COMMITTED' }).expect(200);
  await request(app).post(`/api/financing/funding-plans/${fundingPlanId}/transition`).set(actor).send({ state: 'SETTLEMENT_READY' }).expect(200);
  await request(app).post(`/api/financing/home-projects/${homeProjectId}/transition`).set(actor).send({ state: 'SETTLEMENT_READY' }).expect(200);
  return { homeProjectId, fundingPlanId };
}

test('SRA prepares, locks, executes, records, and converts a Home Project into an Asset Account', async () => {
  const { app } = await createApp({ serveStatic: false, seedMarketplace: false });
  const { homeProjectId } = await createSettlementReadyProject(app);

  const readiness = await request(app)
    .get(`/api/settlement/settlements/readiness/${homeProjectId}`)
    .expect(200);
  assert.equal(readiness.body.ready, true);
  assert.deepEqual(readiness.body.missing, []);

  const prepared = await request(app)
    .post('/api/settlement/settlements/prepare')
    .set(actor)
    .send({ homeProjectId })
    .expect(201);

  const settlementId = prepared.body.settlementId;
  assert.equal(prepared.body.state, 'READY');
  assert.equal(prepared.body.settlementPackage.state, 'IMMUTABLE_PREPARED_PACKAGE');
  assert.equal(typeof prepared.body.settlementPackage.packageHash, 'string');

  await request(app)
    .post(`/api/settlement/settlements/${settlementId}/lock`)
    .set(actor)
    .send({})
    .expect(200);

  const executed = await request(app)
    .post(`/api/settlement/settlements/${settlementId}/execute`)
    .set(actor)
    .send({
      recordingReference: 'COUNTY-RECORDING-001',
      settlementReference: 'SRA-CLOSE-001',
      assetName: '300 Settlement Avenue',
      region: 'Ogden, Utah'
    })
    .expect(200);

  assert.equal(executed.body.settlement.state, 'COMPLETED');
  assert.equal(executed.body.settlementRecord.state, 'COMPLETED');
  assert.equal(executed.body.settlementRecord.immutable, true);
  assert.equal(executed.body.assetAccount.state, 'ACTIVE');
  assert.equal(executed.body.assetAccount.ownerId, 'CUSTOMER-SETTLEMENT-001');
  assert.equal(executed.body.homeProject.state, 'SETTLED');
  assert.equal(executed.body.fundingPlan.state, 'SETTLED');

  const settlementRecord = await request(app)
    .get(`/api/settlement/settlement-records/${executed.body.settlementRecord.settlementRecordId}`)
    .expect(200);
  assert.equal(settlementRecord.body.assetId, executed.body.assetAccount.assetId);
  assert.equal(typeof settlementRecord.body.recordHash, 'string');

  const events = await request(app)
    .get(`/api/settlement/settlements/${settlementId}/events`)
    .expect(200);
  assert.ok(events.body.events.some((event) => event.eventType === 'SRA_SETTLEMENT_PREPARED'));
  assert.ok(events.body.events.some((event) => event.eventType === 'SRA_SETTLEMENT_LOCKED'));
  assert.ok(events.body.events.some((event) => event.eventType === 'SRA_SETTLEMENT_COMPLETED'));
});

test('SRA blocks settlement preparation when readiness is incomplete', async () => {
  const { app } = await createApp({ serveStatic: false, seedMarketplace: false });
  const project = await request(app)
    .post('/api/financing/home-projects')
    .set(actor)
    .send({ customerId: 'CUSTOMER-NOT-READY', property: { address: '400 Not Ready Road' }, purchasePrice: 250000, verifiedBuyerFunds: 50000 })
    .expect(201);

  const readiness = await request(app)
    .get(`/api/settlement/settlements/readiness/${project.body.homeProjectId}`)
    .expect(200);
  assert.equal(readiness.body.ready, false);
  assert.ok(readiness.body.missing.length > 0);

  const blocked = await request(app)
    .post('/api/settlement/settlements/prepare')
    .set(actor)
    .send({ homeProjectId: project.body.homeProjectId })
    .expect(400);
  assert.match(blocked.body.error, /not ready/i);
});
