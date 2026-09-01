import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrapPath = new URL('../public/public-bootstrap.js', import.meta.url);
const syncPath = new URL('../public/live-market-publication-sync.js', import.meta.url);

test('public marketplace loads the publication synchronizer after the transaction terminal', async () => {
  const bootstrap = await readFile(bootstrapPath, 'utf8');
  const marketplace = bootstrap.match(/marketplace:\s*\{[\s\S]*?\n\s*\},/)?.[0] || '';
  const terminalIndex = marketplace.indexOf('/transaction-market-ui.js');
  const syncIndex = marketplace.indexOf('/live-market-publication-sync.js');
  assert.ok(terminalIndex >= 0, 'transaction terminal must be mapped to the Marketplace workspace');
  assert.ok(syncIndex > terminalIndex, 'publication synchronizer must follow the terminal in the lazy Marketplace bundle');
  const coreFeatures = bootstrap.match(/const CORE_FINAL_FEATURES = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(coreFeatures, /live-market-publication-sync/);
});

test('publication synchronizer refreshes the actual marketplace without interrupting active input', async () => {
  const source = await readFile(syncPath, 'utf8');
  assert.match(source, /REFRESH_INTERVAL_MS = 60000/);
  assert.match(source, /renderTransactionMarketSection/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /userIsEditingMarketControls/);
  assert.match(source, /visibilitychange/);
});
