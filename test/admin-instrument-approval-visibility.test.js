import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/admin/admin-instrument-approvals.js', import.meta.url), 'utf8');

test('shows instrument approve controls in overview and pending review', () => {
  assert.match(source, /new Set\(\['Overview','Pending Review'\]\)/);
  assert.match(source, /pendingStates\.has\(state\)/);
  assert.match(source, /button\.textContent = 'Approve'/);
});

test('approves only the selected instrument through the governed endpoint', () => {
  assert.match(source, /listing-readiness-batch\/approve/);
  assert.match(source, /JSON\.stringify\(\{ approval: 'APPROVE', instrumentId \}\)/);
});
