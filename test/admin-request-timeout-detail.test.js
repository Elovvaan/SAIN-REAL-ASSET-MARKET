import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');

test('admin requests use bounded operation-aware timeouts and bypass stale browser cache', () => {
  assert.match(runtime, /ADMIN_SESSION_TIMEOUT_MS = 15_000/);
  assert.match(runtime, /ADMIN_READ_TIMEOUT_MS = 60_000/);
  assert.match(runtime, /ADMIN_WRITE_TIMEOUT_MS = 180_000/);
  assert.match(runtime, /cache: isAdminRequest \? 'no-store'/);
  assert.match(runtime, /Administration \$\{operation\} timed out after/);
});
