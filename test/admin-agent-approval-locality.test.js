import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workstation = fs.readFileSync(new URL('../public/admin/admin-agent-operations-workstation.js', import.meta.url), 'utf8');

test('workflow approvals only render executable administrator work', () => {
  assert.match(workstation, /function executableApproval\(item\)/);
  assert.match(workstation, /items = items\.filter\(executableApproval\)/);
  assert.match(workstation, /Boolean\(action\.executionAction\)/);
  assert.match(workstation, /Boolean\(action\.jobId \|\| item\?\.jobId\)/);
  assert.match(workstation, /No executable agent approval is waiting in this window/);
});

test('agent-owned tabs reject foreign legacy presentation', () => {
  assert.match(workstation, /function removeForeignAgentPresentation\(workspace\)/);
  assert.match(workstation, /!child\.matches\('\[data-agent-operation-card\]'\)/);
  assert.match(workstation, /new MutationObserver\(\(\) => removeForeignAgentPresentation\(workspace\)\)/);
});

test('approved chain work executes without leaving the agent portal', () => {
  assert.match(workstation, /data-agent-execute-chain-job/);
  assert.match(workstation, /action:'EXECUTE_CHAIN_JOB'/);
  assert.match(workstation, /approval:'APPROVE'/);
  assert.match(workstation, /window\.dispatchEvent\(new CustomEvent\('sra:admin-refresh'/);
});
