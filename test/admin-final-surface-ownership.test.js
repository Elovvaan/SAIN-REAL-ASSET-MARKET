import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Administration boots the final shell directly without a legacy presentation pass', () => {
  const page = read('public/admin/index.html');
  const bootstrap = read('public/admin/admin-bootstrap.js');
  assert.match(page, /data-admin-boot-placeholder/);
  assert.doesNotMatch(page, /id="metrics"/);
  assert.doesNotMatch(page, /id="asset-details"/);
  assert.doesNotMatch(page, /id="chat-log"/);
  assert.doesNotMatch(bootstrap, /retireLegacyPresentation/);
  assert.doesNotMatch(bootstrap, /concealLegacyFirstPaint/);
  assert.match(bootstrap, /single-shell-lazy-workspaces/);
  assert.match(bootstrap, /removeBootPlaceholder/);
});

test('Administration feature workstations are loaded by workspace instead of serially at boot', () => {
  const bootstrap = read('public/admin/admin-bootstrap.js');
  assert.match(bootstrap, /const WORKSPACE_FEATURES = \{/);
  assert.match(bootstrap, /async function loadWorkspaceFeatures/);
  assert.doesNotMatch(bootstrap, /FEATURES\.slice\(1\)/);
  assert.match(bootstrap, /workspaceLoads = new Map\(\)/);
  assert.match(bootstrap, /data-admin-workspace.*data-open-workspace/);
});

test('Administrative Agent conversation is owned by the final workstation', () => {
  const agent = read('public/admin/admin-agent-operations-workstation.js');
  assert.match(agent, /ownedTabs = new Set\(\['Conversation','Suggested Actions','Workflow Approvals','Incomplete Workflows'\]\)/);
  assert.match(agent, /data-agent-conversation-form/);
  assert.match(agent, /data-agent-quick-question/);
  assert.match(agent, /\/api\/admin\/agent\/query/);
  assert.match(agent, /records\.style\.display = ownedTabs\.has\(tab\) \? 'none' : ''/);
  assert.match(agent, /data-agent-execute-chain-job/);
});