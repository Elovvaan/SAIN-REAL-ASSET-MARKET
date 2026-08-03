import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

async function signinInstitution(app) {
  const response = await request(app)
    .post('/api/access/signin')
    .send({ email: 'operations@sra.demo', password: 'Operations123!' })
    .expect(200);
  const cookie = response.headers['set-cookie'];
  await request(app)
    .post('/api/access/role')
    .set('Cookie', cookie)
    .send({ role: 'INSTITUTIONAL_OPERATOR' })
    .expect(200);
  return cookie;
}

async function createEligibleHomeProject(app) {
  const actor = { 'x-sra-actor-id': 'SRA-PROJECT-OPERATOR' };
  const project = await request(app)
    .post('/api/financing/home-projects')
    .set(actor)
    .send({
      customerId: 'CUSTOMER-P15-001',
      title: 'Phase 15 Home Project',
      property: { address: '515 Participation Street, Ogden, Utah', propertyType: 'RESIDENTIAL' },
      purchasePrice: 350000,
      verifiedBuyerFunds: 50000
    })
    .expect(201);
  const homeProjectId = project.body.homeProjectId;
  await request(app).post(`/api/financing/home-projects/${homeProjectId}/transition`).set(actor).send({ state: 'DATA_COLLECTION' }).expect(200);
  await request(app).put(`/api/financing/home-projects/${homeProjectId}`).set(actor).send({ snapshotId: 'EDX-SNAPSHOT-P15', valuePackageId: 'EDX-VVP-P15' }).expect(200);
  await request(app).post(`/api/financing/home-projects/${homeProjectId}/transition`).set(actor).send({ state: 'PACKAGE_READY' }).expect(200);
  const plan = await request(app)
    .post('/api/financing/funding-plans')
    .set(actor)
    .send({
      homeProjectId,
      sources: [
        { type: 'BUYER_FUNDS', amount: 50000, status: 'VERIFIED' },
        { type: 'PARTICIPATION_CAPITAL', amount: 300000, status: 'PROPOSED' }
      ]
    })
    .expect(201);
  return { homeProjectId, fundingPlanId: plan.body.fundingPlanId };
}

test('institution sees authorized Home Project, records interest, reviews, and commits capital without underwriting workflow', async () => {
  const { app } = await createApp({ serveStatic: false, seedMarketplace: false });
  const cookie = await signinInstitution(app);
  const { homeProjectId } = await createEligibleHomeProject(app);

  const participationPlan = await request(app)
    .post('/api/institutions/plans')
    .set('x-sra-actor-id', 'SRA-PUBLICATION-OPERATOR')
    .send({
      homeProjectId,
      targetAmount: 300000,
      publicationAuthorizationReference: 'CUSTOMER-PUBLICATION-AUTH-P15',
      participationTermsReference: 'TERMS-P15',
      riskDisclosureReference: 'RISK-P15',
      region: 'Ogden, Utah'
    })
    .expect(201);

  await request(app)
    .post(`/api/institutions/plans/${participationPlan.body.planId}/open`)
    .set('x-sra-actor-id', 'SRA-PUBLICATION-OPERATOR')
    .send({})
    .expect(200);

  const workspace = await request(app)
    .get('/api/institutions/workspace')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(workspace.body.queues.incoming.length, 1);
  assert.equal(workspace.body.queues.incoming[0].homeProjectId, homeProjectId);

  const interest = await request(app)
    .post('/api/institutions/commitments')
    .set('Cookie', cookie)
    .send({ planId: participationPlan.body.planId, amount: 125000 })
    .expect(201);
  assert.equal(interest.body.state, 'INTERESTED');

  await request(app)
    .post(`/api/institutions/commitments/${interest.body.commitmentId}/transition`)
    .set('Cookie', cookie)
    .send({ state: 'UNDER_REVIEW' })
    .expect(200);

  const committed = await request(app)
    .post(`/api/institutions/commitments/${interest.body.commitmentId}/transition`)
    .set('Cookie', cookie)
    .send({ state: 'COMMITTED', termsAcknowledgementReference: 'ACK-P15', capitalSourceReference: 'CAPITAL-ACCOUNT-P15' })
    .expect(200);
  assert.equal(committed.body.state, 'COMMITTED');
  assert.equal(committed.body.amount, 125000);

  const after = await request(app)
    .get('/api/institutions/workspace')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(after.body.queues.committed.length, 1);
  assert.equal(after.body.queues.incoming.length, 0);
});

test('institution workspace requires Institutional Operator capacity and prevents over-commitment', async () => {
  const { app } = await createApp({ serveStatic: false, seedMarketplace: false });
  const universal = await request(app)
    .post('/api/access/signin')
    .send({ email: 'user@sra.demo', password: 'User123!' })
    .expect(200);
  await request(app).get('/api/institutions/workspace').set('Cookie', universal.headers['set-cookie']).expect(403);

  const cookie = await signinInstitution(app);
  const { homeProjectId } = await createEligibleHomeProject(app);
  const plan = await request(app)
    .post('/api/institutions/plans')
    .send({ homeProjectId, targetAmount: 100000, publicationAuthorizationReference: 'AUTH-OVER', participationTermsReference: 'TERMS-OVER', riskDisclosureReference: 'RISK-OVER' })
    .expect(201);
  await request(app).post(`/api/institutions/plans/${plan.body.planId}/open`).send({}).expect(200);

  const blocked = await request(app)
    .post('/api/institutions/commitments')
    .set('Cookie', cookie)
    .send({ planId: plan.body.planId, amount: 100001 })
    .expect(400);
  assert.match(blocked.body.error, /exceeds/i);
});
