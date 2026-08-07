import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/admin/admin-instrument-approvals.js', import.meta.url), 'utf8');

test('instrument approval is separate from native platform asset approval', () => {
  assert.doesNotMatch(source, /platform-asset\/bootstrap/);
  assert.match(source, /data-workspace=\\"instruments\\"/);
});
