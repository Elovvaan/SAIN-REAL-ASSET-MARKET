import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pagePath = new URL('../public/support/index.html', import.meta.url);
const cssPath = new URL('../public/support/support.css', import.meta.url);

test('public customer support page exposes required support content', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /Customer Support/);
  assert.match(page, /Account Support/);
  assert.match(page, /Payments & Funding/);
  assert.match(page, /Transactions/);
  assert.match(page, /Never share passwords, private keys, seed phrases/);
  assert.match(page, /Open secure support workspace/);
  assert.match(page, /\/brand-logo/);
});

test('public support page has dedicated responsive styling', async () => {
  const css = await readFile(cssPath, 'utf8');
  assert.match(css, /\.support-card/);
  assert.match(css, /\.two-column/);
  assert.match(css, /@media/);
});
