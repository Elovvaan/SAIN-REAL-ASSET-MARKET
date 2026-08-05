import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexPath = new URL('../public/index.html', import.meta.url);
const syncPath = new URL('../public/live-market-publication-sync.js', import.meta.url);

test('public marketplace loads the publication synchronizer after the transaction terminal', async () => {
  const html = await readFile(indexPath, 'utf8');
  const terminalIndex = html.indexOf('/transaction-market-ui.js');
  const syncIndex = html.indexOf('/live-market-publication-sync.js');
  assert.ok(terminalIndex >= 0, 'transaction terminal script must be loaded');
  assert.ok(syncIndex > terminalIndex, 'publication synchronizer must load after the terminal exposes its refresh function');
});

test('publication synchronizer refreshes the actual marketplace without interrupting active input', async () => {
  const source = await readFile(syncPath, 'utf8');
  assert.match(source, /15000/);
  assert.match(source, /renderTransactionMarketSection/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /userIsEditingMarketControls/);
  assert.match(source, /visibilitychange/);
});
