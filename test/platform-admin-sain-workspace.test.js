import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync(new URL('../public/platform-admin-workspace.js', import.meta.url), 'utf8');
const accountCapacities = fs.readFileSync(new URL('../public/account-capacities.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('Platform Administration renders a live SAIN operating workspace', () => {
  assert.match(accountCapacities, /renderPlatformAdminWorkspace/);
  assert.match(workspace, /SAIN Operating Workspace/);
  assert.match(workspace, /PLATFORM_ADMIN/);
  assert.match(workspace, /\/api\/sane\/agent\/chat/);
});

test('administrative workspace reads core platform systems', () => {
  assert.match(workspace, /coinbase-public\/status/);
  assert.match(workspace, /observations\/summary/);
  assert.match(workspace, /financial-records\/coin-positions/);
  assert.match(workspace, /financial-records\/instruments/);
  assert.match(workspace, /platform-treasury\/crypto-wallets\/dashboard/);
});

test('state-changing work remains behind an approval queue', () => {
  assert.match(workspace, /Approval queue/);
  assert.match(workspace, /approval required/i);
  assert.match(workspace, /No proposed changes are waiting/);
});

test('administration assets load before account capacity routing', () => {
  assert.match(index, /platform-admin-workspace\.css/);
  assert.match(index, /platform-admin-workspace\.js[\s\S]*account-capacities\.js/);
});
