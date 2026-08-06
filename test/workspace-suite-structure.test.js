import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Administration suite exposes the locked operating workspaces', () => {
  const source = read('public/admin/admin-suite-shell.js');
  for (const label of [
    'Unified Market Operations', 'Treasury', 'Native Platform Asset',
    'Marketplace Lifecycle', 'Instruments', 'Financial Records',
    'Coin Positions', 'Transactions', 'Export & Settlement',
    'SAIN Administrative Agent', 'Platform Connections',
    'Users & Permissions', 'System Health'
  ]) assert.match(source, new RegExp(label.replace(/[&]/g, '\\&')));
  assert.match(source, /admin-dashboard-card/);
  assert.match(source, /routeKnownSections/);
});

test('Participant suite exposes fixed navigation, journey, and action rail', () => {
  const source = read('public/participant-workspace-suite.js');
  for (const label of [
    'Home', 'Marketplace', 'Create Instrument', 'Financing', 'My Positions',
    'Asset Vault', 'Transactions', 'SRA Coin', 'Predictions \/ Liquidity', 'Account'
  ]) assert.match(source, new RegExp(label));
  assert.match(source, /Continue where you left off/);
  assert.match(source, /Your approved capabilities/);
  assert.match(source, /Review with SAIN/);
  assert.match(source, /Review Financing/);
  assert.match(source, /Review Order/);
});

test('suite loaders preserve the original core modules', () => {
  const adminLoader = read('public/admin/admin-button-diagnostics.js');
  const participantLoader = read('public/workspace-shell.js');
  const participantBootstrap = read('public/participant-workspace-bootstrap.js');
  assert.match(adminLoader, /admin-button-diagnostics-core\.js/);
  assert.match(adminLoader, /admin-suite-shell\.js/);
  assert.match(participantLoader, /workspace-shell-core\.js/);
  assert.match(participantLoader, /participant-workspace-bootstrap\.js/);
  assert.match(participantBootstrap, /participant-workspace-suite\.js/);
  assert.ok(fs.existsSync(new URL('../public/admin/admin-button-diagnostics-core.js', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../public/workspace-shell-core.js', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../public/participant-workspace-bootstrap.js', import.meta.url)));
});
