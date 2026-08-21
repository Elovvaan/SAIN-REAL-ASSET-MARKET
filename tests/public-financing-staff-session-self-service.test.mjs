import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { FundingOpportunityIntakeService } from '../services/funding-opportunity-intake-service.js';
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

async function buildApp({ roles, source = 'SERVER_SESSION', identity }) {
  const domain = new MemoryDomain();
  const service = new FundingOpportunityIntakeService(domain);
  await service.initialize();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sraOperationsAuth = { roles, source };
    req.sraIdentity = identity;
    next();
  });
  app.use('/api/funding', createFundingOpportunityRouter(service));
  return { app, domain, service };
}

test('staff-capable SERVER_SESSION can submit the public financing form as itself', async () => {
  const { app, domain } = await buildApp({
    roles: ['UNIVERSAL', 'PLATFORM_ADMIN'],
    identity: {
      actorId: 'USR-OPS-PUBLIC',
      universalAccountId: 'UA-OPS-PUBLIC',
      email: 'ops-public@example.test',
      displayName: 'Operations Public User',
    },
  });

  const response = await request(app)
    .post('/api/funding/opportunities')
    .send({
      title: 'Public self-service equipment request',
      opportunityType: 'EQUIPMENT',
      purpose: 'PURCHASE',
      requestedAmount: 25000,
      currency: 'USD',
      description: 'Submitted from the signed-in public workspace.',
    })
    .expect(201);

  assert.ok(response.body.applicantParticipantId);
  const participant = domain.get('PARTICIPANT', response.body.applicantParticipantId);
  assert.equal(participant.metadata.accessAccountId, 'USR-OPS-PUBLIC');
  assert.equal(participant.metadata.universalAccountId, 'UA-OPS-PUBLIC');
  assert.equal(response.body.applicantParticipantId, participant.id);
});

test('staff session with an explicit applicant reference still uses the admin applicant path', async () => {
  const { app, domain } = await buildApp({
    roles: ['PLATFORM_ADMIN'],
    identity: { actorId: 'USR-ADMIN', email: 'admin@example.test' },
  });
  await domain.put('PARTICIPANT', 'P-CLIENT', {
    id: 'P-CLIENT',
    displayName: 'Client Company',
    type: 'ORGANIZATION',
    metadata: { contactEmail: 'client@example.test' },
  });

  const response = await request(app)
    .post('/api/funding/opportunities')
    .send({
      applicantParticipantId: 'P-CLIENT',
      title: 'Admin-entered client request',
      opportunityType: 'EQUIPMENT',
      purpose: 'PURCHASE',
      requestedAmount: 10000,
      currency: 'USD',
    })
    .expect(201);

  assert.equal(response.body.applicantParticipantId, 'P-CLIENT');
});
