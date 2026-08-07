import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/admin/admin-instrument-approvals.js', import.meta.url), 'utf8');

test('instrument approval script does not invoke native platform asset approval', () => {
  assert.equal(source.includes('/api/admin/platform-asset/bootstrap'), false);
});
