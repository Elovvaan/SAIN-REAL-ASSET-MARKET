import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
const workstation = fs.readFileSync(new URL('../public/admin/admin-marketplace-lifecycle-workstation.js', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../public/admin/admin-marketplace-stage-actions.js', import.meta.url), 'utf8');
const adminRouter = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');

test('marketplace opens with a record-backed investor funding flow', () => {
  assert.match(shell, /marketplace:\['Investor Funding Flow','Prepared'/);
  assert.match(workstation, /Approved obligation/);
  assert.match(workstation, /Position & collateral/);
  assert.match(workstation, /Investor offering/);
  assert.match(workstation, /Verified funding/);
  assert.match(workstation, /Servicing & distributions/);
  assert.match(workstation, /sourceRecords: workspaceRecords/);
});

test('investor funding flow remains read-only while governed stage controls remain available', () => {
  assert.match(actions, /The flow view reconciles existing records/);
  assert.match(actions, /State-changing controls remain in Prepared, Published, Orders, Reservations, Allocations, and Settlement/);
  assert.match(actions, /open-window/);
  assert.match(actions, /authorize-settlement/);
  assert.match(actions, /verify-confirmation/);
});

test('marketplace workspace exposes obligation, position, ownership, and servicing lineage', () => {
  assert.match(adminRouter, /marketplace-investor-lineage/);
  assert.match(adminRouter, /fundingOpportunities: domain\.list\(RECORD_TYPES\.FUNDING_OPPORTUNITY\)/);
  assert.match(adminRouter, /servicingEvents: domain\.list\(RECORD_TYPES\.ASSET_SERVICING_EVENT\)/);
});
