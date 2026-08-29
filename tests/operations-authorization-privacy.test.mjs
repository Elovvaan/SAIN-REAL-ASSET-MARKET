import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsAuthorization } from '../middleware/operations-authorization.js';

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request({ method = 'GET', path, cookie = '' } = {}) {
  return {
    method,
    path,
    headers: { cookie },
  };
}

function accessServiceFor(sessionByToken = {}) {
  return {
    async getSession(token) { return sessionByToken[token] || null; },
  };
}

const staffSession = {
  id: 'USR-ADMIN',
  universalAccountId: 'UA-ADMIN',
  email: 'admin@example.com',
  displayName: 'Admin',
  activeCapacity: 'PLATFORM_ADMIN',
  capacities: [{ id: 'PLATFORM_ADMIN' }],
  roles: [{ id: 'PLATFORM_ADMIN' }],
};

const participantSession = {
  id: 'USR-PARTICIPANT',
  universalAccountId: 'UA-PARTICIPANT',
  email: 'participant@example.com',
  displayName: 'Participant',
  activeCapacity: 'UNIVERSAL',
  capacities: [{ id: 'UNIVERSAL' }],
  roles: [{ id: 'UNIVERSAL' }],
};

async function run(middleware, req) {
  const res = responseCapture();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

test('unauthenticated operational GET requests are private by default', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: async () => accessServiceFor() });
  for (const path of [
    '/api/funding/opportunities',
    '/api/funding/opportunities/OPP-1',
    '/api/financing-closing/closings',
    '/api/financing-closing/closings/FCL-1',
    '/api/financing-closing/exports/EXP-1/settlement-route',
    '/api/on-chain/stable-settlement-assets',
  ]) {
    const result = await run(middleware, request({ path }));
    assert.equal(result.nextCalled, false, path);
    assert.equal(result.res.statusCode, 401, path);
    assert.equal(result.res.body?.code, 'SRA_AUTHENTICATION_REQUIRED', path);
  }
});

test('authenticated staff can read operational endpoints allowed by role', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: async () => accessServiceFor({ staff: staffSession }) });
  const result = await run(middleware, request({ path: '/api/funding/opportunities', cookie: 'sra_session=staff' }));
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.sraOperationsAuth.actorId, 'USR-ADMIN');
});

test('authenticated participant cannot read staff operational collections', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: async () => accessServiceFor({ participant: participantSession }) });
  const result = await run(middleware, request({ path: '/api/funding/opportunities', cookie: 'sra_session=participant' }));
  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.res.body?.code, 'SRA_SERVER_ROLE_REQUIRED');
});

test('explicit participant self-service read remains available to an authenticated participant', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: async () => accessServiceFor({ participant: participantSession }) });
  const result = await run(middleware, request({ path: '/api/funding-verification/participant-actions', cookie: 'sra_session=participant' }));
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.sraOperationsAuth.source, 'SERVER_SESSION');
});

test('external settlement confirmation callback remains outside session authentication', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: async () => { throw new Error('should not be called'); } });
  const result = await run(middleware, request({ method: 'POST', path: '/api/funding-marketplace-settlement/confirmations/external' }));
  assert.equal(result.nextCalled, true);
});

test('unrelated public paths are unaffected', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: async () => { throw new Error('should not be called'); } });
  const result = await run(middleware, request({ path: '/api/health' }));
  assert.equal(result.nextCalled, true);
});
