import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const router = read('routes/private-admin-router.js');
const shell = read('public/admin/admin-suite-shell.js');
const records = read('public/admin/admin-financial-records-workstation.js');
const agent = read('public/admin/admin-agent-operations-workstation.js');

test('every administration workspace with tabs has server-side tab scoping', () => {
  for (const workspace of ['operations','treasury','nativeAsset','marketplace','instruments','records','coinPositions','transactions','settlement','agent','connections','users','system']) {
    assert.match(router, new RegExp(`(?:^|\\n)\\s*${workspace}: \\{`));
  }
});

test('shell delegates timeout ownership to the shared administration client', () => {
  assert.doesNotMatch(shell, /platform did not respond within 10 seconds/i);
  assert.doesNotMatch(shell, /setTimeout\(\(\) => controller\.abort\(\),10000\)/);
  assert.match(shell, /function scalar\(value\)/);
  assert.match(shell, /viewErrors:new Map\(\)/);
  assert.doesNotMatch(shell, /lastError/);
});

test('Financial Records includes configured Stellar and XRPL public accounts', () => {
  for (const variable of ['STELLAR_DISTRIBUTOR_PUBLIC_KEY','STELLAR_ISSUER_PUBLIC_KEY','XRPL_ADDRESS','XRPL_ISSUER_ADDRESS']) assert.match(router, new RegExp(variable));
  assert.match(router, /recordType:'NETWORK_ACCOUNT'/);
  assert.match(router, /publicAddress:true/);
  assert.match(records, /r\.networkAccounts/);
  assert.match(records, /Public address/);
  assert.match(records, /workspace=records&tab=\$\{encodeURIComponent\(selectedTab\)\}/);
});

test('every Administrative Agent tab owns a visible functional render path', () => {
  for (const tab of ['Conversation','Capital Activation','Workforce','Suggested Actions','Workflow Approvals','Incomplete Workflows','Explain Record','Trace Instrument','Platform Questions','Diagnostics']) assert.match(agent, new RegExp(tab));
  assert.match(agent, /data-agent-tool-form/);
  assert.match(agent, /loadingMarkup/);
  assert.match(agent, /if \(hasChainWork\).*await chainHealth\(\)/);
  assert.doesNotMatch(agent, /Promise\.all\(\[request\(\{ question:'Give me the operational brief and work queue\.' \}\), chainHealth\(\)\]\)/);
});
