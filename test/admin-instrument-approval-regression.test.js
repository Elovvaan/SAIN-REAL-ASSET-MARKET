import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/admin/admin-instrument-approvals.js', import.meta.url), 'utf8');

test('draft instrument approvals are visible and scoped', () => {
  assert.match(source, /new Set\(\['Overview','Pending Review'\]\)/);
  assert.match(source, /pendingStates\.has\(state\)/);
  assert.match(source, /JSON\.stringify\(\{ approval: 'APPROVE', instrumentId \}\)/);
  assert.doesNotMatch(source, /platform-asset\/bootstrap/);
});
