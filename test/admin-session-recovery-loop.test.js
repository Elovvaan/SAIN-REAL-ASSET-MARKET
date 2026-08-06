import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');

test('expired admin sessions do not trigger reload loops', () => {
  assert.doesNotMatch(source, /location\.reload\s*\(/);
  assert.match(source, /sessionRecoveryStarted/);
  assert.match(source, /login-view/);
  assert.match(source, /Sign in again/i);
});

test('session and bootstrap probes do not trigger protected-session recovery', () => {
  assert.match(source, /isSessionProbe/);
  assert.match(source, /bootstrap-status/);
  assert.match(source, /\/api\/admin\/session/);
  assert.match(source, /!isSessionProbe\s*&&\s*response\.status\s*===\s*401/);
});
