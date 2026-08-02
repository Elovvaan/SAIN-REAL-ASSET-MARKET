import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
import {
  actorId,
  enterpriseId,
  connectorDefinition,
  connection,
  policy,
  sourceRecords
} from './fixtures/edx-pipeline-fixture.js';

function api(agent) {
  return {
    post: (path, body) => agent.post(path).set('x-sra-actor-id', actorId).send(body),
    get: (path) => agent.get(path).set('x-sra-actor-id', actorId)
  };
}

test('complete company-controlled EDX pipeline proves private and published outcomes', async () => {
  const { app } = await createApp({
    connectionString: process.env.TEST_DATABASE_URL || '',
    serveStatic: false,
    seedMarketplace: false
  });
  const agent = request(app);
  const client = api(agent);

  const connectorResponse = await client.post('/api/edx/connector-definitions', connectorDefinition).expect(201);
  assert.equal(connectorResponse.body.connectorDefinitionId, connectorDefinition.connectorDefinitionId);

  const connectionResponse = await client.post('/api/edx/connections', connection).expect(201);
  assert.equal(connectionResponse.body.enterpriseId, enterpriseId);
  await client.post(`/api/edx/connections/${connection.connectionId}/transition`, { state: 'AUTHORIZATION_PENDING' }).expect(200);
  await client.post(`/api/edx/connections/${connection.connectionId}/transition`, {
    state: 'CONNECTED',
    authorizationReference: 'TEST-AUTHORIZATION-001'
  }).expect(200);
  await client.post(`/api/edx/connections/${connection.connectionId}/transition`, { state: 'ACTIVE' }).expect(200);

  await client.post('/api/edx/policies', policy).expect(201);
  await client.post(`/api/edx/policies/${policy.policyId}/transition`, { state: 'ACTIVE' }).expect(200);

  const extractionRequest = await client.post('/api/edx/extraction-requests', {
    policyId: policy.policyId,
    enterpriseId,
    recordCategory: 'DAILY_NET_REVENUE',
    visibility: 'MARKETPLACE',
    requestedTimeRange: {
      start: '2026-08-02T00:00:00.000Z',
      end: '2026-08-02T23:59:59.999Z'
    }
  }).expect(201);
  const extractionRequestId = extractionRequest.body.extractionRequestId;

  await client.post(`/api/edx/extraction-requests/${extractionRequestId}/transition`, {
    state: 'APPROVED',
    companyApprovalReference: 'TEST-EXTRACTION-APPROVAL-001'
  }).expect(200);

  const extractionExecution = await client.post(`/api/edx/extraction-requests/${extractionRequestId}/execute`, {
    sourcePayloadReference: 'fixture://daily-books/2026-08-02',
    sourceTimestamp: '2026-08-02T12:05:00.000Z',
    sourceRecords
  }).expect(200);
  const extractionResult = extractionExecution.body.result;
  assert.equal(extractionResult.approvedRecordCount, 1);
  assert.equal(extractionResult.records[0].fields.net_total, 125000);
  assert.equal('customer_name' in extractionResult.records[0].fields, false);
  assert.equal('customer_email' in extractionResult.records[0].fields, false);

  const normalized = await client.post(`/api/edx/extraction-results/${extractionResult.extractionResultId}/normalize`, {
    category: 'DAILY_NET_REVENUE',
    sourceSystem: 'TEST_DAILY_BOOKS',
    defaultCurrency: 'USD'
  }).expect(201);
  assert.equal(normalized.body.createdCount, 1);
  const normalizedRecordId = normalized.body.records[0].normalizedRecordId;

  const verifiedRecord = await client.post(`/api/edx/normalized-records/${normalizedRecordId}/verification`, {
    verificationState: 'VERIFIED',
    note: 'Fixture source and structure verified.'
  }).expect(200);
  assert.equal(verifiedRecord.body.verificationState, 'VERIFIED');

  const snapshot = await client.post('/api/edx/snapshots/generate', {
    enterpriseId,
    periodStart: '2026-08-02T00:00:00.000Z',
    periodEnd: '2026-08-02T23:59:59.999Z',
    primaryCurrency: 'USD',
    visibility: 'PRIVATE'
  }).expect(201);
  assert.equal(snapshot.body.state, 'COMPLETE');
  assert.equal(snapshot.body.metrics.revenue, 125000);
  assert.equal(snapshot.body.frozen, true);

  const valuePackage = await client.post('/api/edx/value-packages/generate', {
    snapshotId: snapshot.body.snapshotId,
    visibility: 'MARKETPLACE',
    supportedUses: [
      'MARKETPLACE_LISTING',
      'PARTICIPATION_OPPORTUNITY',
      'FINANCING_WORKFLOW',
      'PERFORMANCE_TRACKING',
      'ANALYTICS'
    ]
  }).expect(201);
  assert.equal(valuePackage.body.state, 'ACTIVE');

  const privateDecision = await client.post('/api/edx/publication-decisions', {
    valuePackageId: valuePackage.body.valuePackageId,
    decision: 'KEEP_PRIVATE',
    reason: 'Company chose not to publish the first review.'
  }).expect(201);
  assert.equal(privateDecision.body.state, 'EXECUTED');

  const projectionsAfterPrivate = await client.get(`/api/edx/marketplace-projections?enterpriseId=${enterpriseId}`).expect(200);
  assert.equal(projectionsAfterPrivate.body.marketplaceProjections.length, 0);

  const publishDecision = await client.post('/api/edx/publication-decisions', {
    valuePackageId: valuePackage.body.valuePackageId,
    decision: 'PUBLISH_TODAY'
  }).expect(201);
  assert.equal(publishDecision.body.state, 'PENDING');

  await client.post(`/api/edx/publication-decisions/${publishDecision.body.publicationDecisionId}/approve`, {
    companyApprovalReference: 'TEST-PUBLISH-APPROVAL-001',
    approvalScope: 'PUBLISH_CURRENT_PACKAGE_ONLY',
    distributionTargets: ['SRA_MARKETPLACE']
  }).expect(200);

  const published = await client.post(`/api/edx/publication-decisions/${publishDecision.body.publicationDecisionId}/execute`, {}).expect(200);
  assert.equal(published.body.decision.state, 'EXECUTED');
  assert.equal(published.body.projection.state, 'PUBLISHED');
  assert.equal(published.body.projection.companyApprovalReference, 'TEST-PUBLISH-APPROVAL-001');

  const projectionsAfterPublish = await client.get(`/api/edx/marketplace-projections?enterpriseId=${enterpriseId}`).expect(200);
  assert.equal(projectionsAfterPublish.body.marketplaceProjections.length, 1);
  assert.equal(projectionsAfterPublish.body.marketplaceProjections[0].valuePackageId, valuePackage.body.valuePackageId);
});
