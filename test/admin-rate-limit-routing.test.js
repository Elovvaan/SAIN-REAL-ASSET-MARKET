import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../middleware/production-runtime.js', import.meta.url), 'utf8');

test('private administration reads and writes use separate rate-limit classes', () => {
  assert.match(runtime, /ADMIN_READ/);
  assert.match(runtime, /ADMIN_WRITE/);
  assert.match(runtime, /path\.startsWith\('\/api\/admin'\)/);
  assert.match(runtime, /String\(method\)\.toUpperCase\(\) === 'GET'/);
  assert.match(runtime, /ADMIN_READ: \[2400, 60_000\]/);
  assert.match(runtime, /ADMIN_WRITE: \[120, 60_000\]/);
  assert.match(runtime, /routeClass\(req\.path, req\.method\)/);
});
