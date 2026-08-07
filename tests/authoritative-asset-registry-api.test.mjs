import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import { createAuthoritativeAssetRegistryRouter } from '../routes/authoritative-asset-registry-router.js';
import { AuthoritativeAssetRegistryService } from '../services/authoritative-asset-registry-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

function createMemoryDomain() {
  const records = new Map();
  return {
    get(type, id) { return records.get(`${type}:${id}`) || null; },
    list(type) {
      const prefix = `${type}:`;
      return [...records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
    },
    async put(type, id, payload) { records.set(`${type}:${id}`, structuredClone(payload)); return payload; },
    async lifecycle(input) {
      const id = `LE-${records.size + 1}`;
      const event = { id, ...input };
      records.set(`${RECORD_TYPES.LIFECYCLE_EVENT}:${id}`, event);
      return event;
    },
  };
}

function createAccessService() {
  return {
    async getSession(token) {
      if (token === 'admin-token') return { id: 'ADMIN-1', activeCapacity: 'PLATFORM_ADMIN' };
      if (token === 'user-token') return { id: 'USER-1', activeCapacity: 'PARTICIPANT' };
      return null;
    },
  };
}

function createApi() {
  const domain = createMemoryDomain();
  const service = new AuthoritativeAssetRegistryService(domain);
  const app = express();
  app.use(express.json());
  app.use('/api/authoritative-registry', createAuthoritativeAssetRegistryRouter(service, createAccessService()));
  return { app, domain, service };
}

test('requires platform administration authority', async () => {
  const { app } = createApi();
  const response = await request(app)
    .get('/api/authoritative-registry/assets/A-1/relationships')
    .set('Authorization', 'Bearer user-token');
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'SRA_AUTHORITATIVE_REGISTRY_ADMIN_REQUIRED');
});

test('registers a relationship and returns a state conflict explanation', async () => {
  const { app, domain } = createApi();
  await domain.put(RECORD_TYPES.ASSET_ACCOUNT, 'A-1', {
    id: 'A-1', assetId: 'A-1', version: 1, verifiedValue: 1000,
  });

  const first = await request(app)
    .post('/api/authoritative-registry/assets/A-1/relationships')
    .set('Authorization', 'Bearer admin-token')
    .send({
      subjectParticipantId: 'OWNER-1',
      relationshipType: 'OWNS',
      authorityReference: 'AUTH-1',
      expectedAssetVersion: 1,
    });
  assert.equal(first.status, 201);

  const conflict = await request(app)
    .post('/api/authoritative-registry/assets/A-1/relationships')
    .set('Authorization', 'Bearer admin-token')
    .send({
      subjectParticipantId: 'OWNER-2',
      relationshipType: 'OWNS',
      authorityReference: 'AUTH-2',
      expectedAssetVersion: 1,
    });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'EXCLUSIVE_OWNER_CONFLICT');
  assert.match(conflict.body.explanation, /different active owner/i);
});

test('reserves and releases position capacity through the API', async () => {
  const { app, domain } = createApi();
  await domain.put(RECORD_TYPES.ASSET_ACCOUNT, 'A-1', {
    id: 'A-1', assetId: 'A-1', version: 1, verifiedValue: 1000,
  });
  await domain.put(RECORD_TYPES.PARTICIPATION_POSITION, 'P-1', {
    id: 'P-1', positionId: 'P-1', assetId: 'A-1', version: 4, transferableValue: 100,
  });

  const created = await request(app)
    .post('/api/authoritative-registry/positions/P-1/reservations')
    .set('Authorization', 'Bearer admin-token')
    .send({
      assetId: 'A-1',
      amount: 60,
      purpose: 'SETTLEMENT',
      instructionId: 'SI-1',
      expectedPositionVersion: 4,
    });
  assert.equal(created.status, 201);
  const reservationId = created.body.reservation.id;

  const rejected = await request(app)
    .post('/api/authoritative-registry/positions/P-1/reservations')
    .set('Authorization', 'Bearer admin-token')
    .send({
      assetId: 'A-1',
      amount: 50,
      purpose: 'TRANSFER',
      expectedPositionVersion: 4,
    });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'INSUFFICIENT_TRANSFERABLE_CAPACITY');

  const released = await request(app)
    .post(`/api/authoritative-registry/reservations/${reservationId}/release`)
    .set('Authorization', 'Bearer admin-token')
    .send({ reason: 'External execution cancelled.', evidenceIds: ['EV-1'] });
  assert.equal(released.status, 200);
  assert.equal(released.body.reservation.status, 'RELEASED');
});

test('returns an authoritative asset state snapshot', async () => {
  const { app, domain } = createApi();
  await domain.put(RECORD_TYPES.ASSET_ACCOUNT, 'A-1', {
    id: 'A-1', assetId: 'A-1', version: 2, verifiedValue: 500,
  });
  await domain.put(RECORD_TYPES.PARTICIPATION_POSITION, 'P-1', {
    id: 'P-1', positionId: 'P-1', assetId: 'A-1', version: 1,
    transferableValue: 100, allocatedAmount: 20,
  });

  const response = await request(app)
    .get('/api/authoritative-registry/assets/A-1/state')
    .set('Authorization', 'Bearer admin-token');
  assert.equal(response.status, 200);
  assert.equal(response.body.snapshot.assetVersion, 2);
  assert.equal(response.body.snapshot.recognizedValue, 500);
  assert.equal(response.body.snapshot.availableCapacity, 80);
});
