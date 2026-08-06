import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');

test('administration request runtime carries credentials, times out, and recovers expired sessions', () => {
  assert.match(runtime, /credentials:\s*'include'/);
  assert.match(runtime, /AbortController/);
  assert.match(runtime, /ADMIN_REQUEST_TIMEOUT_MS/);
  assert.match(runtime, /response\.status\s*===\s*401/);
  assert.match(runtime, /sra-admin-session-expired/);
  assert.match(runtime, /window\.location\.reload/);
});
