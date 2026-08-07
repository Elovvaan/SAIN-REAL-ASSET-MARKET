import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reconciliation = fs.readFileSync(new URL('../public/admin/admin-action-reconciliation.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');
const agent = fs.readFileSync(new URL('../services/admin-intelligence-agent-service.js', import.meta.url), 'utf8');

test('admin loader installs action reconciliation before workspace controls', () => {
  const reconciliationIndex = loader.indexOf('/admin/admin-action-reconciliation.js');
  const suiteIndex = loader.indexOf('/admin/admin-suite-shell.js');
  assert.ok(reconciliationIndex >= 0);
  assert.ok(suiteIndex > reconciliationIndex);
});

test('reconciliation de-duplicates protected native asset writes', () => {
  assert.match(reconciliation, /activeWrites\.get\(key\)/);
  assert.match(reconciliation, /NATIVE_PLATFORM_ASSET_BOOTSTRAP/);
  assert.match(reconciliation, /reconcileNativePlatformAsset/);
  assert.match(reconciliation, /readyForExport/);
});

test('reconciliation normalizes the incomplete product workflows prompt', () => {
  assert.match(reconciliation, /incomplete\\s\+product\\s\+workflows/i);
  assert.match(reconciliation, /Generate an operational brief showing all incomplete workflows and the next action for each\./);
});

test('server agent exposes operational brief support', () => {
  assert.match(agent, /GENERATE_OPERATIONAL_BRIEF/);
  assert.match(agent, /operationalBrief\(\)/);
  assert.match(agent, /incomplete workflows/);
});
