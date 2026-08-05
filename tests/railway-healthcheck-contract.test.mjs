import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const railway = JSON.parse(await readFile(new URL('../railway.json', import.meta.url), 'utf8'));
const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');

test('Railway healthcheck uses the startup liveness route', () => {
  assert.equal(railway.deploy.healthcheckPath, '/api/startup');
  assert.equal(railway.deploy.healthcheckTimeout, 100);
});

test('startup route remains healthy while initializing and fails only after startup failure', () => {
  assert.match(server, /bootstrap\.get\('\/api\/startup'/);
  assert.match(server, /startupState === 'FAILED' \? 500 : 200/);
});

test('dependency readiness remains separate from Railway liveness', () => {
  assert.match(server, /bootstrap\.get\('\/api\/health'/);
  assert.match(server, /dependencies\.status === 'READY' \? 200 : 503/);
  assert.notEqual(railway.deploy.healthcheckPath, '/api/health');
});
