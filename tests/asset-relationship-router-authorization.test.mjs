import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAssetRelationshipRouter } from '../routes/asset-relationship-router.js';

const relationships = [
  { relationshipId: 'REL-ISSUER', instrumentId: 'INS-1', relationshipType: 'ISSUER', partyId: 'SRA', sourceType: 'SRA_INSTRUMENT', sourceId: 'INS-1', amount: 1000 },
  { relationshipId: 'REL-A-COMMIT', instrumentId: 'INS-1', relationshipType: 'COMMITTER', partyId: 'USER-A', sourceType: 'FUNDING_MARKETPLACE_COMMITMENT', sourceId: 'COM-A', amount: 400 },
  { relationshipId: 'REL-B-ALLOC', instrumentId: 'INS-1', relationshipType: 'ALLOCATED_HOLDER', partyId: 'USER-B', sourceType: 'FUNDING_MARKETPLACE_POSITION', sourceId: 'ALLOC-B', amount: 600 },
  { relationshipId: 'REL-B-SETTLE', instrumentId: 'INS-1', relationshipType: 'SETTLED_PARTY', partyId: 'USER-B', sourceType: 'SRA_SETTLEMENT_RECORD', sourceId: 'SET-B', amount: 600 },
  { relationshipId: 'REL-B-OWNER', instrumentId: 'INS-1', relationshipType: 'CURRENT_OWNER', partyId: 'USER-B', sourceType: 'OWNERSHIP_RECOGNITION', sourceId: 'OWN-B', quantity: 600 },
];

function appFor(session) {
  const service = {
    list(instrumentId, filters = {}) {
      return relationships.filter((record) => record.instrumentId === instrumentId).filter((record) => !filters.partyId || record.partyId === filters.partyId);
    },
    publicView(instrumentId) {
      return {
        schema: 'SRA_PUBLIC_RELATIONSHIP_VIEW',
        instrumentId,
        participantCount: 2,
        relationships: relationships.filter((record) => ['ISSUER', 'ORIGINAL_OWNER', 'CURRENT_OWNER', 'CURRENT_HOLDER', 'CUSTODIAN'].includes(record.relationshipType)).map((record) => ({ relationshipType: record.relationshipType, partyId: record.partyId })),
      };
    },
    async synchronizeInstrument() { return { instrumentId: 'INS-1' }; },
  };
  const accessService = { async getSession(token) { return token ? session : null; } };
  const app = express();
  app.use(express.json());
  app.use('/api/asset-relationships', createAssetRelationshipRouter(service, accessService));
  return app;
}

test('participant cannot retrieve the full internal multi-party ledger', async () => {
  const response = await request(appFor({ id: 'USER-A', activeCapacity: 'PARTICIPANT' }))
    .get('/api/asset-relationships/instruments/INS-1')
    .set('Authorization', 'Bearer participant-token');
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'SRA_INTERNAL_RELATIONSHIP_LEDGER_ADMIN_REQUIRED');
  assert.equal(JSON.stringify(response.body).includes('SET-B'), false);
  assert.equal(JSON.stringify(response.body).includes('OWN-B'), false);
});

test('participant receives only their own private relationship records', async () => {
  const response = await request(appFor({ id: 'USER-A', activeCapacity: 'PARTICIPANT' }))
    .get('/api/asset-relationships/instruments/INS-1/my-relationships')
    .set('Authorization', 'Bearer participant-token');
  assert.equal(response.status, 200);
  assert.equal(response.body.internal, false);
  assert.equal(response.body.relationshipCount, 1);
  assert.equal(response.body.relationships[0].partyId, 'USER-A');
  assert.equal(JSON.stringify(response.body).includes('USER-B'), false);
  assert.equal(JSON.stringify(response.body).includes('SET-B'), false);
});

test('related participant may retrieve only the reduced public export view', async () => {
  const response = await request(appFor({ id: 'USER-A', activeCapacity: 'PARTICIPANT' }))
    .get('/api/asset-relationships/instruments/INS-1/export-view')
    .set('Authorization', 'Bearer participant-token');
  assert.equal(response.status, 200);
  assert.equal(response.body.schema, 'SRA_PUBLIC_RELATIONSHIP_VIEW');
  assert.equal(JSON.stringify(response.body).includes('COM-A'), false);
  assert.equal(JSON.stringify(response.body).includes('ALLOC-B'), false);
  assert.equal(JSON.stringify(response.body).includes('SET-B'), false);
  assert.equal(JSON.stringify(response.body).includes('amount'), false);
});

test('platform administrator can retrieve the full internal ledger', async () => {
  const response = await request(appFor({ id: 'ADMIN-1', activeCapacity: 'PLATFORM_ADMIN' }))
    .get('/api/asset-relationships/instruments/INS-1')
    .set('Authorization', 'Bearer admin-token');
  assert.equal(response.status, 200);
  assert.equal(response.body.internal, true);
  assert.equal(response.body.relationshipCount, relationships.length);
  assert.equal(response.body.relationships.some((record) => record.sourceId === 'SET-B'), true);
});
