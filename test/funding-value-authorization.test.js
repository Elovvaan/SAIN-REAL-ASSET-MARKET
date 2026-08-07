import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/funding-opportunity-value-preparation-router.js', import.meta.url), 'utf8');
const authorization = fs.readFileSync(new URL('../middleware/operations-authorization.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('funding value mutations use only server-derived actor identity', () => {
  assert.match(router, /req\.sraOperationsAuth\?\.actorId/);
  assert.doesNotMatch(router, /x-sra-actor-id/);
  assert.doesNotMatch(router, /req\.body\?\.actorId/);
  assert.match(router, /requireAuthenticatedActor/);
  assert.match(router, /SRA_AUTHENTICATION_REQUIRED/);
});

test('funding-value writes are covered by the server operations authorization middleware', () => {
  assert.match(authorization, /'\/api\/funding-value'/);
  assert.match(authorization, /WRITE_METHODS/);
  assert.match(authorization, /req\.sraOperationsAuth=\{actorId:session\.id/);
  assert.match(server, /bootstrap\.use\(authorizeOperationsRequest\)/);
  assert.match(server, /req\.path\.startsWith\('\/api\/funding-value'\)/);
});
