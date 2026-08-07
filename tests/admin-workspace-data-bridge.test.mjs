import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('loads the workspace data bridge before the admin workspace shell', () => {
  const loader = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');
  const bridgeIndex = loader.indexOf('/admin/admin-workspace-data-bridge.js');
  const shellIndex = loader.indexOf('/admin/admin-suite-shell.js');
  assert.ok(bridgeIndex >= 0, 'workspace bridge must be loaded');
  assert.ok(shellIndex >= 0, 'workspace shell must be loaded');
  assert.ok(bridgeIndex < shellIndex, 'workspace bridge must load before the shell');
});

test('caps the all-domain workspace payload and hides duplicated metric cards', () => {
  const bridge = fs.readFileSync(new URL('../public/admin/admin-workspace-data-bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /WORKSPACE_RECORD_LIMIT\s*=\s*100/);
  assert.match(bridge, /pathname === '\/api\/admin\/workspaces'/);
  assert.match(bridge, /searchParams\.set\('limit'/);
  assert.match(bridge, /admin-workspace-controls \.metric/);
});
