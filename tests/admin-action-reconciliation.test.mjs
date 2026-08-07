import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const client = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
const agent = fs.readFileSync(new URL('../services/admin-intelligence-agent-service.js', import.meta.url), 'utf8');

test('consolidated data client de-duplicates protected native asset writes', () => {
  assert.match(client, /activeWrites\.has\(key\)/);
  assert.match(client, /NATIVE_PLATFORM_ASSET_BOOTSTRAP/);
  assert.match(client, /reconcileNativePlatformAsset/);
  assert.match(client, /readyForExport/);
});

test('administrative prompt is canonical in the owning page instead of normalized by a DOM observer', () => {
  assert.match(index, /Generate an operational brief showing all incomplete workflows and the next action for each\./);
  assert.doesNotMatch(client, /MutationObserver/);
});

test('server agent exposes operational brief support', () => {
  assert.match(agent, /GENERATE_OPERATIONAL_BRIEF/);
  assert.match(agent, /operationalBrief\(\)/);
  assert.match(agent, /incomplete workflows/);
});
