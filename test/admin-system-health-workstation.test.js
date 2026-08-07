import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const health = fs.readFileSync(new URL('../public/admin/admin-system-health-workstation.js', import.meta.url), 'utf8');

test('System Health workstation is explicitly loaded and mounted', () => {
  assert.match(bootstrap, /admin-system-health-workstation\.js/);
  assert.match(bootstrap, /mountAdminSystemHealthWorkstation\?\.\(admin\.querySelector\('\[data-workspace=\\"system\\"\]'\)\)/);
  assert.match(health, /window\.mountAdminSystemHealthWorkstation = mount/);
});

test('System Health uses the canonical SRA Core Services brief without a second health model', () => {
  assert.match(health, /\/api\/sane\/core-services\/brief/);
  assert.match(health, /does not manufacture a second health state/);
  assert.doesNotMatch(health, /MutationObserver/);
  assert.doesNotMatch(health, /DOMContentLoaded/);
});

test('all System Health tabs have coherent stage-specific read models', () => {
  for (const label of ['System Operating State','Core Service Engine Cycle','Diagnostics','Protected Action Boundary','Operational Alerts','System Audit State']) {
    assert.match(health, new RegExp(label));
  }
  assert.match(health, /Scheduler → engine cycle → persistent platform movement → next operating state/);
  assert.match(health, /HUMAN IN THE LOOP/);
});