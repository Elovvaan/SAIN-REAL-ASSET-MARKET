import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const agent = fs.readFileSync(new URL('../services/admin-intelligence-agent-service.js', import.meta.url), 'utf8');
const chainAgent = fs.readFileSync(new URL('../services/platform-chain-operations-agent-service.js', import.meta.url), 'utf8');
const chainService = fs.readFileSync(new URL('../services/sra-coin-chain-service.js', import.meta.url), 'utf8');
const workstation = fs.readFileSync(new URL('../public/admin/admin-agent-operations-workstation.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');

test('administrative agent delegates real chain operations work', () => {
  assert.match(agent, /PlatformChainOperationsAgentService/);
  assert.match(agent, /DISPATCH_PLATFORM_CHAIN_OPERATIONS_AGENT/);
  assert.match(agent, /chainOperationsSummary/);
  assert.match(agent, /pendingActions: approvals\.pendingActions/);
  assert.match(agent, /EXECUTE_CHAIN_JOB/);
  assert.match(agent, /this\.chainOperationsAgent\.execute/);
});

test('chain execution remains behind explicit administrator approval', () => {
  assert.match(agent, /action.*EXECUTE_CHAIN_JOB/s);
  assert.match(workstation, /approval: 'APPROVE'/);
  assert.match(workstation, /\/api\/admin\/agent\/query/);
  assert.doesNotMatch(workstation, /\/api\/on-chain\/solana\/sra\/mint/);
});

test('agent workstation renders work in existing administration tabs', () => {
  assert.match(workstation, /Suggested Actions/);
  assert.match(workstation, /Workflow Approvals/);
  assert.match(workstation, /Incomplete Workflows/);
  assert.match(workstation, /Approve & Execute/);
  assert.match(bootstrap, /admin-agent-operations-workstation\.js/);
  assert.match(bootstrap, /mountAdminAgentOperationsWorkstation/);
});

test('reviewed chain approval is bound to a supply snapshot and target', () => {
  assert.match(chainAgent, /snapshotVersion/);
  assert.match(chainAgent, /CHAIN-SRA-SYNC:\$\{snapshot\.snapshotVersion\}/);
  assert.match(chainAgent, /approvedTargetSupply !== job\.targetSupply/);
  assert.match(chainAgent, /SRA_CHAIN_APPROVAL_SNAPSHOT_STALE/);
  assert.match(workstation, /data-target-supply/);
  assert.match(workstation, /targetSupply: Number\(button\.dataset\.targetSupply/);
});

test('SRA chain service mints the approved target instead of any later aggregate', () => {
  assert.match(chainService, /targetSupply=input\.targetSupply===undefined\?currentSupply/);
  assert.match(chainService, /authorizedSupply:targetSupply/);
  assert.match(chainService, /expectedIssuedOnChainSupply/);
  assert.match(chainService, /approvedTargetSupply:targetSupply/);
});
