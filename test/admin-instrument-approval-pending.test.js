import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/admin/admin-instrument-approvals.js', import.meta.url), 'utf8');

test('pending review tab remains supported', () => {
  assert.match(source, /'Pending Review'/);
});
