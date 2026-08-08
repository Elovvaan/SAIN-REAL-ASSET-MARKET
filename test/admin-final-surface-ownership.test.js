import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('final Administration shell physically retires the legacy DOM before reveal', () => {
  const bootstrap = read('public/admin/admin-bootstrap.js');
  assert.match(bootstrap, /function retireLegacyPresentation\(admin\)/);
  assert.match(bootstrap, /for \(const child of \[\.\.\.admin\.children\]\)/);
  assert.match(bootstrap, /if \(child !== suite\) child\.remove\(\)/);
  const shellLoaded = bootstrap.indexOf('await loadScript(shellSource, shellMarker)');
  const retire = bootstrap.indexOf('retireLegacyPresentation(admin)');
  const reveal = bootstrap.indexOf('revealAdminSuite(admin)');
  const remainingFeatures = bootstrap.indexOf('FEATURES.slice(1)');
  assert.ok(shellLoaded >= 0 && retire > shellLoaded, 'legacy presentation retires only after the final shell mounts');
  assert.ok(reveal > retire, 'legacy presentation is gone before Administration is revealed');
  assert.ok(remainingFeatures > reveal, 'feature workstations load into the final shell after reveal');
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
