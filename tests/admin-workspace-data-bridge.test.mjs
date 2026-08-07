import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');

test('loads the consolidated data client before the administration bootstrap', () => {
  const clientIndex = index.indexOf('/admin/admin-data-client.js');
  const bootstrapIndex = index.indexOf('/admin/admin-bootstrap.js');
  assert.ok(clientIndex >= 0, 'admin data client must be loaded');
  assert.ok(bootstrapIndex >= 0, 'admin bootstrap must be loaded');
  assert.ok(clientIndex < bootstrapIndex, 'data client must load before bootstrap');
  assert.match(bootstrap, /admin-suite-shell\.js/);
});

test('consolidated client caps and enriches workspace payloads', () => {
  assert.match(client, /WORKSPACE_RECORD_LIMIT\s*=\s*100/);
  assert.match(client, /pathname !== '\/api\/admin\/workspaces'/);
  assert.match(client, /searchParams\.set\('limit'/);
  assert.match(client, /enrichWorkspaceResponse/);
});

test('consolidated client surfaces Treasury external transfer instructions in Export & Settlement', () => {
  assert.match(client, /EXTERNAL_TRANSFER_INSTRUCTION/);
  assert.match(client, /records\.settlementInstructions/);
  assert.match(client, /record\.amountUsd/);
  assert.match(client, /record\.destinationReference/);
  assert.match(client, /record\.transferInstructionId/);
});

test('legacy workspace bridge and sync are not loaded by the active bootstrap', () => {
  assert.doesNotMatch(bootstrap, /admin-workspace-data-bridge\.js/);
  assert.doesNotMatch(bootstrap, /admin-workspace-sync\.js/);
  assert.doesNotMatch(bootstrap, /admin-button-diagnostics\.js/);
});
