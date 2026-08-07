import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const client = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics-core.js', import.meta.url), 'utf8');

test('expired admin sessions do not trigger reload loops', () => {
  assert.doesNotMatch(diagnostics, /location\.reload\s*\(/);
  assert.match(diagnostics, /sessionRecoveryStarted/);
  assert.match(diagnostics, /login-view/);
  assert.match(diagnostics, /Sign in again/i);
});

test('session and bootstrap probes do not trigger protected-session recovery', () => {
  assert.match(client, /isSessionProbe/);
  assert.match(client, /bootstrap-status/);
  assert.match(client, /\/api\/admin\/session/);
  assert.match(client, /!isSessionProbe && response\.status === 401/);
});
