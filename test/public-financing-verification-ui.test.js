import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import { createOperationsAuthorization } from '../middleware/operations-authorization.js';
import { createFinancingClosingRouter } from '../routes/financing-closing-router.js';

const source = fs.readFileSync(new URL('../public/verify-financing.html', import.meta.url), 'utf8');

test('public financing verification distinguishes record, service, and timeout responses', () => {
  assert.match(source, /response\.status===404/);
  assert.match(source, /Authorization not found/);
  assert.match(source, /Verification temporarily unavailable/);
  assert.match(source, /Verification timed out/);
  assert.match(source, /AbortController/);
});

test('the exact public LFA lookup resolves without an authenticated session', async () => {
  const records = new Map([
    ['SRA_TRANSACTION:LFA-F7DA0CA9', { transactionId:'LFA-F7DA0CA9', transactionType:'LOAN_FINANCING_AUTHORIZATION', state:'POSTED', status:'FINANCING_AVAILABLE', opportunityId:'FOR-1', borrowerParticipantId:'P-1', amount:3900000, currency:'USD' }],
    ['FUNDING_OPPORTUNITY:FOR-1', { opportunityId:'FOR-1', applicantParticipantId:'P-1', financingStage:'FINANCING_AVAILABLE' }],
    ['PARTICIPANT:P-1', { displayName:'SAIN Real Asset' }],
  ]);
  const domain = {
    database:null,
    async hydrate() {},
    async hydrateRecord(type,id) { return records.get(`${type}:${id}`) || null; },
    get(type,id) { return records.get(`${type}:${id}`) || null; },
    list() { return []; },
  };
  const service = { domain, status:()=>({}), list:()=>[] };
  const app = express();
  app.use(createOperationsAuthorization({ accessServiceProvider:async()=>{ throw new Error('public lookup reached authentication'); } }));
  app.use('/api/financing-closing', createFinancingClosingRouter(service));
  const response = await request(app).get('/api/financing-closing/verification/LFA-F7DA0CA9');
  assert.equal(response.status, 200);
  assert.equal(response.body.verified, true);
  assert.equal(response.body.authorizationReference, 'LFA-F7DA0CA9');
});
