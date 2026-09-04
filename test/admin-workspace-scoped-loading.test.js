import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('administration workspace endpoint loads only the requested domain collections', () => {
  const router = read('routes/private-admin-router.js');
  assert.match(router, /requestedWorkspace = String\(req\.query\.workspace/);
  assert.match(router, /requestedTab = String\(req\.query\.tab/);
  assert.match(router, /new Set\(tabSources \|\| ADMIN_WORKSPACE_SOURCES\[requestedWorkspace\]\)/);
  assert.match(router, /for \(const key of requestedKeys\)/);
  assert.match(router, /treasury: \['instruments','transactions','treasuryProfiles'/);
});

test('admin workstations request scoped payloads instead of the full platform domain', () => {
  assert.match(read('public/admin/admin-suite-shell.js'), /workspaces\?workspace=\$\{encodeURIComponent\(scope\)\}&tab=\$\{encodeURIComponent\(tab\)\}&limit=100/);
  assert.match(read('public/admin/admin-treasury-workstation.js'), /workspaces\?workspace=treasury&limit=100/);
  assert.match(read('public/admin/admin-financial-records-workstation.js'), /workspaces\?workspace=records&limit=100/);
  assert.match(read('public/admin/admin-users-permissions-workstation.js'), /workspaces\?workspace=users&limit=250/);
});

test('scoped responses merge into the existing admin cache without removing other tabs', () => {
  const shell = read('public/admin/admin-suite-shell.js');
  assert.match(shell, /records:\{\.\.\.\(state\.workspaceData\?\.records\|\|\{\}\),\.\.\.\(data\.records\|\|\{\}\)\}/);
  assert.match(shell, /loadedScopes\.add\(scope\)/);
  assert.match(shell, /loadedViews\.add\(key\)/);
});

test('heavy admin collections render only when their tab is selected', () => {
  const router=read('routes/private-admin-router.js');
  assert.match(router, /Pending Review':\['instruments'\]/);
  assert.match(router, /'Mint History':\['lifecycleEvents'\]/);
  assert.match(router, /'Export Packages':\['exportPackages'\]/);
  const shell=read('public/admin/admin-suite-shell.js');
  assert.match(shell, /void ensureSelectedTab\(id\)/);
  assert.match(shell, /loadingViews\.has\(viewKey\(id,tab\)\)/);
});
