import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsAuthorization } from '../middleware/operations-authorization.js';

function req({ path = '/api/funding/opportunities', method = 'POST', cookie = '', headers = {}, body = {} } = {}) {
  return {
    path,
    method,
    body,
    headers: { cookie, ...headers },
    get(name) { return this.headers[String(name).toLowerCase()] || this.headers[name] || ''; },
  };
}

function res() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function run(middleware, request) {
  const response = res();
  let nextCalled = false;
  await middleware(request, response, () => { nextCalled = true; });
  return { response, nextCalled, request };
}

function provider(sessionByToken) {
  return async () => ({
    async getSession(token) { return sessionByToken[token] || null; },
  });
}

const customer = {
  id: 'USR-CUSTOMER',
  universalAccountId: 'UA-CUSTOMER',
  email: 'customer@example.com',
  displayName: 'Customer',
  activeCapacity: 'UNIVERSAL',
  capacities: [{ id: 'UNIVERSAL' }],
  roles: [{ id: 'UNIVERSAL' }],
};

const admin = {
  id: 'USR-ADMIN',
  universalAccountId: 'UA-ADMIN',
  email: 'admin@example.com',
  activeCapacity: 'PLATFORM_ADMIN',
  capacities: [{ id: 'UNIVERSAL' }, { id: 'PLATFORM_ADMIN' }],
  roles: [{ id: 'PLATFORM_ADMIN' }],
};

const verifier = {
  id: 'USR-VERIFY',
  universalAccountId: 'UA-VERIFY',
  email: 'verify@example.com',
  activeCapacity: 'VERIFICATION_REVIEWER',
  capacities: [{ id: 'VERIFICATION_REVIEWER' }],
  roles: [{ id: 'VERIFICATION_REVIEWER' }],
};

test('missing session returns 401', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({}) });
  const { response, nextCalled } = await run(middleware, req());
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.code, 'SRA_AUTHENTICATION_REQUIRED');
});

test('forged staff headers without session remain unauthorized', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({}) });
  const { response } = await run(middleware, req({ headers: { 'x-sra-role': 'PLATFORM_ADMIN', 'x-sra-roles': 'PLATFORM_ADMIN' } }));
  assert.equal(response.statusCode, 401);
});

test('authenticated participant can create their own funding intake', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ customer }) });
  const request = req({ cookie: 'sra_session=customer', headers: { 'x-sra-actor-id': 'FORGED-ACTOR' } });
  const { response, nextCalled } = await run(middleware, request);
  assert.equal(response.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(request.sraIdentity.actorId, 'USR-CUSTOMER');
  assert.equal(request.sraOperationsAuth.source, 'SERVER_SESSION');
});

test('authenticated participant can upload evidence to funding intake', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ customer }) });
  const { response, nextCalled } = await run(middleware, req({ path: '/api/funding/opportunities/FOR-1/documents', cookie: 'sra_session=customer' }));
  assert.equal(response.statusCode, 200);
  assert.equal(nextCalled, true);
});

test('customer session cannot perform staff-controlled funding write', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ customer }) });
  const { response, nextCalled } = await run(middleware, req({ path: '/api/funding/opportunities/FOR-1/complete-intake', cookie: 'sra_session=customer' }));
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, 'SRA_SERVER_ROLE_REQUIRED');
});

test('platform admin session is authorized and actor is server-derived', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ admin }) });
  const request = req({ cookie: 'sra_session=admin', headers: { 'x-sra-actor-id': 'FORGED-ACTOR' } });
  const { nextCalled } = await run(middleware, request);
  assert.equal(nextCalled, true);
  assert.equal(request.sraOperationsAuth.actorId, 'USR-ADMIN');
  assert.equal(request.sraOperationsAuth.source, 'SERVER_SESSION');
});

test('on-chain write falls back to active private admin session when standard session is stale', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ stale: null, admin }) });
  const request = req({
    path: '/api/on-chain/representations/issue',
    cookie: 'sra_session=stale; sra_admin_session=admin',
  });
  const { nextCalled, response } = await run(middleware, request);
  assert.equal(response.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(request.sraOperationsAuth.actorId, 'USR-ADMIN');
  assert.equal(request.sraOperationsAuth.source, 'PRIVATE_ADMIN_SESSION');
});

test('private admin session is accepted for funding operations through the private-admin boundary', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ admin }) });
  const request = req({ path: '/api/funding/opportunities', cookie: 'sra_admin_session=admin' });
  const { response, nextCalled } = await run(middleware, request);
  assert.equal(response.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(request.sraOperationsAuth.source, 'PRIVATE_ADMIN_SESSION');
});

test('private admin session supplies the authenticated actor for platform treasury operations', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ admin }) });
  const request = req({ path: '/api/platform-treasury/usdc-conversions', cookie: 'sra_admin_session=admin' });
  const { response, nextCalled } = await run(middleware, request);
  assert.equal(response.statusCode, 200);
  assert.equal(nextCalled, true);
  assert.equal(request.sraOperationsAuth.actorId, 'USR-ADMIN');
  assert.equal(request.sraOperationsAuth.source, 'PRIVATE_ADMIN_SESSION');
  assert.equal(request.sraIdentity.activeCapacity, 'PLATFORM_ADMIN');
});

test('expired or signed-out session returns 401', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ expired: null, signedout: null }) });
  for (const token of ['expired', 'signedout']) {
    const { response } = await run(middleware, req({ cookie: `sra_session=${token}` }));
    assert.equal(response.statusCode, 401);
  }
});

test('verification reviewer can access verification desk', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ verifier }) });
  const { nextCalled } = await run(middleware, req({ path: '/api/funding-verification/requests/VR-1/start', cookie: 'sra_session=verifier' }));
  assert.equal(nextCalled, true);
});

test('verification reviewer cannot authorize issuance', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({ verifier }) });
  const { response, nextCalled } = await run(middleware, req({ path: '/api/funding-instrument-issuance/reviews/IR-1/decision', cookie: 'sra_session=verifier' }));
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
});

test('read-only operational requests remain accessible', async () => {
  const middleware = createOperationsAuthorization({ accessServiceProvider: provider({}) });
  const { nextCalled } = await run(middleware, req({ method: 'GET', path: '/api/funding-operations/dashboard' }));
  assert.equal(nextCalled, true);
});
