import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('../public/admin/admin-coin-lifecycle-workstation.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../routes/treasury-admin-routes.js', import.meta.url), 'utf8');

test('Coin Positions lifecycle workstation is explicitly loaded and mounted by admin bootstrap', () => {
  assert.match(bootstrap, /admin-coin-lifecycle-workstation\.js/);
  assert.match(bootstrap, /mountAdminCoinLifecycleWorkstation\?\.\(coinWorkspace\)/);
  assert.match(lifecycle, /window\.mountAdminCoinLifecycleWorkstation=mount/);
});

test('Coin Positions lifecycle uses an uncapped aggregate endpoint rather than workspace display records', () => {
  assert.doesNotMatch(lifecycle, /MutationObserver/);
  assert.doesNotMatch(lifecycle, /DOMContentLoaded/);
  assert.doesNotMatch(lifecycle, /#view-root/);
  assert.doesNotMatch(lifecycle, /\/api\/admin\/workspaces/);
  assert.match(lifecycle, /\/api\/admin\/coin-position-lifecycle/);
  assert.match(routes, /\/api\/admin\/coin-position-lifecycle/);
});

test('Coin Positions lifecycle exposes complete read and reconciliation stages', () => {
  for (const label of ['Current SRA Supply','Represented Value Reconciliation','Coin Intelligence','Representation / Mint History','Adjustments','Retirements']) assert.match(lifecycle, new RegExp(label));
  assert.match(lifecycle, /1 SRA = 1 USD/);
  assert.match(lifecycle, /Native source/);
  assert.match(lifecycle, /Recognized USD/);
  assert.match(lifecycle, /Segmentation creates position slices, not new SRA issuance/);
  assert.match(lifecycle, /excluded from par re-test/);
});

test('Adjustment and retirement writes remain disabled until aggregate reconciliation semantics are atomic', () => {
  assert.match(lifecycle, /Write controls','NOT ENABLED/);
  assert.match(lifecycle, /Aggregate reconciliation required first/);
  assert.match(lifecycle, /Atomic supply reduction required/);
});
