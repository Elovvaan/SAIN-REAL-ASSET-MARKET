import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
const financing = fs.readFileSync(new URL('../public/funding-operations-ui.js', import.meta.url), 'utf8');
const awaiting = fs.readFileSync(new URL('../public/admin/admin-financing-awaiting-actions.js', import.meta.url), 'utf8');
const evidence = fs.readFileSync(new URL('../public/admin/admin-financing-evidence.js', import.meta.url), 'utf8');

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
  assert.match(financing, /await openDetail\(root, record\.opportunityId\)/);
  assert.doesNotMatch(financing, /\/api\/funding\/opportunities\/\$\{encodeURIComponent\(opportunityId\)\}\/completeness/);
  assert.match(evidence, /sra:funding-opportunity-created/);
  assert.match(evidence, /sra:funding-opportunity-refresh-requested/);
  assert.match(financing, /sra:funding-opportunity-refresh-requested/);
  assert.match(financing, /\/api\/funding\/opportunities\/\$\{encodeURIComponent\(opportunityId\)\}\/evidence/);
  assert.doesNotMatch(financing, /\/api\/funding-operations\/opportunities\/\$\{encodeURIComponent\(opportunityId\)\}/);
  assert.match(evidence, /Finish document intake and continue/);
  assert.match(evidence, /data-admin-financing-upload-queue/);
  assert.match(evidence, /Uploading \$\{position\} of \$\{total\}/);
  assert.match(evidence, /for \(let index = 0; index < entries\.length; index \+= 1\)/);
  assert.match(evidence, /body\.append\('documents', entry\.file\)/);
  assert.match(evidence, /retry only the failed document/);
  assert.doesNotMatch(evidence, /files\.forEach\(\(file\) => \{\s*body\.append\('documents'/);
  assert.doesNotMatch(financing, /const dashboard = await request\('\/api\/funding-operations\/dashboard'\)/);
  assert.match(awaiting, /dataset\.activeTab === 'Awaiting Actions'/);
  assert.doesNotMatch(awaiting, /tab === 'Financing'/);
  assert.doesNotMatch(awaiting, /sra:admin-financing-rendered/);
});
