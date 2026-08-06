import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');

test('expired admin sessions lock rather than leave the workspace interactive', () => {
  assert.match(source, /view\.inert = true/);
  assert.match(source, /view\.style\.pointerEvents = 'none'/);
  assert.doesNotMatch(source, /location\.reload/);
});

test('successful admin authentication restores diagnostics and canonical instrument selection', () => {
  assert.match(source, /completeSessionRecovery/);
  assert.match(source, /sessionRecoveryStarted = false/);
  assert.match(source, /sra-admin-session-restored/);
  assert.match(source, /enhanceFundingInstrumentControl/);
  assert.match(source, /eligible-instruments/);
});
