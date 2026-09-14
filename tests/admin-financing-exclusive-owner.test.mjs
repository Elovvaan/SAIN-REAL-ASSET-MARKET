import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
const financing = fs.readFileSync(new URL('../public/funding-operations-ui.js', import.meta.url), 'utf8');
const awaiting = fs.readFileSync(new URL('../public/admin/admin-financing-awaiting-actions.js', import.meta.url), 'utf8');

test('Financing is exclusively owned by its lazy workstation', () => {
  assert.match(shell, /FEATURE_ONLY_TABS = new Set\(\['operations::Financing'/);
  assert.match(shell, /if\(!FEATURE_ONLY_TABS\.has/);
  assert.match(shell, /if\(FEATURE_ONLY_TABS\.has/);
});


test('Financing intake loads each workflow stage only when reached', () => {
  assert.match(financing, /id="funding-records-panel" hidden/);
  assert.match(financing, /id="funding-ops-records"/);
  assert.match(financing, /void loadFinancingRecords\(root\)/);
  assert.match(financing, /sra:funding-opportunity-created/);
  assert.doesNotMatch(financing, /const dashboard = await request\('\/api\/funding-operations\/dashboard'\)/);
  assert.match(awaiting, /dataset\.activeTab === 'Awaiting Actions'/);
  assert.doesNotMatch(awaiting, /tab === 'Financing'/);
  assert.doesNotMatch(awaiting, /sra:admin-financing-rendered/);
});
