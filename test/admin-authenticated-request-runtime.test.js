import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const client = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics-core.js', import.meta.url), 'utf8');

test('administration request runtime carries credentials, times out, and recovers expired sessions', () => {
  assert.match(client, /credentials: isAdminRequest \? 'include'/);
  assert.match(client, /AbortController/);
  assert.match(client, /ADMIN_SESSION_TIMEOUT_MS/);
  assert.match(client, /response\.status === 401/);
  assert.match(client, /sra-admin-session-expired/);
  assert.match(diagnostics, /Sign in again/);
  assert.doesNotMatch(diagnostics, /window\.location\.reload/);
});
