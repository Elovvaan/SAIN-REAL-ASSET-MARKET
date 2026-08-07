import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('../public/admin/admin-coin-lifecycle-workstation.js', import.meta.url), 'utf8');

test('Coin Positions lifecycle workstation is explicitly loaded and mounted by admin bootstrap', () => {
  assert.match(bootstrap, /admin-coin-lifecycle-workstation\.js/);
  assert.match(bootstrap, /mountAdminCoinLifecycleWorkstation\?\.\(coinWorkspace\)/);
  assert.match(lifecycle, /window\.mountAdminCoinLifecycleWorkstation = mount/);
});

test('Coin Positions lifecycle workstation stays inside the consolidated admin ownership model', () => {
  assert.doesNotMatch(lifecycle, /MutationObserver/);
  assert.doesNotMatch(lifecycle, /DOMContentLoaded/);
  assert.doesNotMatch(lifecycle, /#view-root/);
  assert.match(lifecycle, /\/api\/admin\/workspaces\?limit=1000/);
});

test('Coin Positions lifecycle exposes the complete read/reconciliation stages', () => {
  for (const label of ['Current SRA Supply', 'Represented Value Reconciliation', 'Coin Intelligence', 'Representation / Mint History', 'Adjustments', 'Retirements']) {
    assert.match(lifecycle, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(lifecycle, /1 SRA = 1 USD/);
  assert.match(lifecycle, /Native source/);
  assert.match(lifecycle, /Recognized USD/);
});

test('Adjustment and retirement writes remain disabled until aggregate reconciliation semantics are atomic', () => {
  assert.match(lifecycle, /Write controls', 'NOT ENABLED/);
  assert.match(lifecycle, /Aggregate reconciliation required first/);
  assert.match(lifecycle, /retirement atomically reduces active Coin Account supply/);
});
