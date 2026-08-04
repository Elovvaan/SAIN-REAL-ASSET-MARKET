import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexUrl = new URL('../public/index.html', import.meta.url);
const scriptUrl = new URL('../public/transaction-market-ui.js', import.meta.url);
const styleUrl = new URL('../public/transaction-market-ui.css', import.meta.url);

test('transaction market UI assets are loaded by the application shell', async () => {
  const index = await readFile(indexUrl, 'utf8');
  assert.match(index, /transaction-market-ui\.css/);
  assert.match(index, /transaction-market-ui\.js/);
});

test('transaction market UI preserves the account and market language contract', async () => {
  const [script, styles] = await Promise.all([
    readFile(scriptUrl, 'utf8'),
    readFile(styleUrl, 'utf8')
  ]);

  assert.match(script, /TRANSACTION MARKET/);
  assert.match(script, /My Asset Vault/);
  assert.match(script, /No participant-linked monetary balance has been recorded yet/);
  assert.match(script, /The records remain records; they are not converted into separate instruments/);
  assert.match(styles, /\.transaction-market-panel/);
  assert.match(styles, /\.asset-vault-view/);
});
