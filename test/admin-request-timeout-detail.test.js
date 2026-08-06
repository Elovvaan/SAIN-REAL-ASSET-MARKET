import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');

test('admin requests use a bounded timeout and bypass stale browser cache', () => {
  assert.match(runtime, /const ADMIN_REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(runtime, /cache:\s*isAdminRequest\s*\?\s*'no-store'/);
  assert.match(runtime, /Administration request timed out after/);
});
