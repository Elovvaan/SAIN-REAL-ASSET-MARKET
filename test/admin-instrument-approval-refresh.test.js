import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/admin/admin-instrument-approvals.js', import.meta.url), 'utf8');

test('refreshes the Instruments workspace after approval', () => {
  assert.match(source, /data-refresh-workspace=\\"instruments\\"/);
  assert.match(source, /refresh\.click\(\)/);
});
