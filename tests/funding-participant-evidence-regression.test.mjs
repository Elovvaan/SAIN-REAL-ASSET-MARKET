import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createFundingOpportunityRouter } from '../routes/funding-opportunity-router.js';

function domainFixture(initialParticipants = []) {
  const participants = new Map(initialParticipants.map((record) => [record.id, structuredClone(record)]));
  return {
    database: null,
    list(type) { return type === 'PARTICIPANT' ? [...participants.values()].map(structuredClone) : []; },
    async put(type, id, payload) { if (type === 'PARTICIPANT') participants.set(id, structuredClone(payload)); return structuredClone(payload); },
    participants,
  };
}

function serviceFixture(domain, opportunity = null) {
  const created = [];
  const evidence = [];
  return {
    domain,
    created,
    evidence,
    status() { return {}; },
    list() { return []; },
    get(id) { return opportunity && opportunity.opportunityId === id ? opportunity : null; },
    async create(input) {
      const participant = domain.participants.get(input.applicantParticipantId);
      if (!participant) throw new Error('Applicant participant was not found.');
      created.push(structuredClone(input));
      return { opportunityId: 'FOR-1', ...input };
    },
    async registerEvidence(_id, input) { evidence.push(structuredClone(input)); return { evidenceId: `FOE-${evidence.length}`, ...input }; },
    async update() { return {}; },
    assessCompleteness() { return {}; },
    async completeIntake() { return {}; },
    listEvidence() { return evidence; },
    listVerificationRequests() { return []; },
    async createVerificationRequest() { return {}; },
    async withdraw() { return {}; },
  };
}

function appFor(service, documentService = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sraIdentity = { actorId: 'USR-123', universalAccountId: 'UA-123', email: 'person@example.com', displayName: 'Person Example' };
    req.sraOperationsAuth = { actorId: 'USR-123', roles: ['UNIVERSAL'], source: 'SERVER_SESSION' };
    next();
  });
  app.use('/api/funding', createFundingOpportunityRouter(service, documentService));
  return app;
}

test('self-service financing creates a durable P-* participant linkage instead of using USR-* as applicantParticipantId', async () => {
  const domain = domainFixture();
  const service = serviceFixture(domain);
  const response = await request(appFor(service))
    .post('/api/funding/opportunities')
    .send({ applicantParticipantId: 'FORGED-P', title: 'Acquisition', opportunityType: 'BUSINESS_ACQUISITION', purpose: 'PURCHASE', requestedAmount: 100, currency: 'USD' });

  assert.equal(response.status, 201);
  assert.match(response.body.applicantParticipantId, /^P-/);
  assert.notEqual(response.body.applicantParticipantId, 'USR-123');
  const participant = domain.participants.get(response.body.applicantParticipantId);
  assert.equal(participant.metadata.accessAccountId, 'USR-123');
  assert.equal(participant.metadata.universalAccountId, 'UA-123');
});

test('self-service financing links a single existing participant by account email', async () => {
  const domain = domainFixture([{ id: 'P-EXISTING', displayName: 'Person Example', type: 'PERSON', roles: ['ASSET_OWNER'], metadata: { contactEmail: 'person@example.com' } }]);
  const service = serviceFixture(domain);
  const response = await request(appFor(service))
    .post('/api/funding/opportunities')
    .send({ title: 'Acquisition', opportunityType: 'BUSINESS_ACQUISITION', purpose: 'PURCHASE', requestedAmount: 100, currency: 'USD' });

  assert.equal(response.status, 201);
  assert.equal(response.body.applicantParticipantId, 'P-EXISTING');
  assert.equal(domain.participants.get('P-EXISTING').metadata.accessAccountId, 'USR-123');
});

test('invalid multi-file evidence batch is rejected before any file is stored or evidence is linked', async () => {
  const domain = domainFixture([{ id: 'P-EXISTING', displayName: 'Person Example', type: 'PERSON', roles: ['FUNDING_APPLICANT'], metadata: { accessAccountId: 'USR-123', contactEmail: 'person@example.com' } }]);
  const opportunity = { opportunityId: 'FOR-1', applicantParticipantId: 'P-EXISTING', status: 'INTAKE_IN_PROGRESS' };
  const service = serviceFixture(domain, opportunity);
  const stored = [];
  const documentService = {
    validateFile(file) { return file.mimetype === 'application/x-bad' ? 'Unsupported document type.' : null; },
    async store(input) { stored.push(input.file.originalname); return { ok: true, document: { id: `DOC-${stored.length}`, sha256: 'abc' } }; },
  };

  const response = await request(appFor(service, documentService))
    .post('/api/funding/opportunities/FOR-1/documents')
    .attach('documents', Buffer.from('valid'), { filename: 'valid.pdf', contentType: 'application/pdf' })
    .attach('documents', Buffer.from('bad'), { filename: 'bad.bin', contentType: 'application/x-bad' });

  assert.equal(response.status, 400);
  assert.deepEqual(stored, []);
  assert.deepEqual(service.evidence, []);
  assert.match(response.body.error, /No documents were stored/i);
});
