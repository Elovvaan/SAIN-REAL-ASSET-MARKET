import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const diagnostics = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics-core.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');

test('expired admin sessions lock rather than leave the workspace interactive', () => {
  assert.match(diagnostics, /view\.inert = true/);
  assert.match(diagnostics, /view\.style\.pointerEvents = 'none'/);
  assert.doesNotMatch(diagnostics, /location\.reload/);
});

test('successful admin authentication restores diagnostics and canonical instrument selection', () => {
  assert.match(client, /sra-admin-session-restored/);
  assert.match(diagnostics, /completeSessionRecovery/);
  assert.match(diagnostics, /sessionRecoveryStarted = false/);
  assert.match(diagnostics, /enhanceFundingInstrumentControl/);
  assert.match(diagnostics, /eligible-instruments/);
});
