import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');

test('Administration requests use operation-aware timeout boundaries', () => {
  assert.match(source, /ADMIN_SESSION_TIMEOUT_MS = 15_000/);
  assert.match(source, /ADMIN_READ_TIMEOUT_MS = 60_000/);
  assert.match(source, /ADMIN_WRITE_TIMEOUT_MS = 180_000/);
  assert.match(source, /SAFE_METHODS = new Set\(\['GET', 'HEAD', 'OPTIONS'\]\)/);
  assert.match(source, /return SAFE_METHODS\.has\(method\) \? ADMIN_READ_TIMEOUT_MS : ADMIN_WRITE_TIMEOUT_MS/);
});

test('non-Administration fetches are not assigned the Administration timeout', () => {
  assert.match(source, /if \(!isAdminRequest\) return 0/);
  assert.match(source, /controller\?\.signal \|\| externalSignal/);
});

test('timeout errors distinguish reads from governed actions', () => {
  assert.match(source, /SAFE_METHODS\.has\(method\) \? 'read' : 'governed action'/);
  assert.match(source, /The server did not confirm completion/);
});
