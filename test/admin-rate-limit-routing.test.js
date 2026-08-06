import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../middleware/production-runtime.js', import.meta.url), 'utf8');
const treasuryUi = fs.readFileSync(new URL('../public/admin/treasury-ledger-ui.js', import.meta.url), 'utf8');

test('private administration reads and writes use separate rate-limit classes', () => {
  assert.match(runtime, /ADMIN_READ/);
  assert.match(runtime, /ADMIN_WRITE/);
  assert.match(runtime, /path\.startsWith\('\/api\/admin'\)/);
  assert.match(runtime, /req\.method === 'GET'/);
});

test('treasury UI honors server retry timing after a 429', () => {
  assert.match(treasuryUi, /retryAfterMs/);
  assert.match(treasuryUi, /SRA_RATE_LIMIT_EXCEEDED/);
  assert.match(treasuryUi, /setTimeout/);
});
