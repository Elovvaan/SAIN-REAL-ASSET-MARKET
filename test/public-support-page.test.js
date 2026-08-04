import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pagePath = new URL('../public/support/index.html', import.meta.url);
const cssPath = new URL('../public/support/support.css', import.meta.url);
const fundingUiPath = new URL('../public/funding-intake-ui.js', import.meta.url);

test('public customer support page exposes accurate support content', async () => {
  const page = await readFile(pagePath, 'utf8');
  assert.match(page, /Customer Support/);
  assert.match(page, /Account Support/);
  assert.match(page, /Payments & Funding/);
  assert.match(page, /Transactions/);
  assert.match(page, /Never share passwords, private keys, seed phrases/);
  assert.match(page, /current SAIN chat provides general platform assistance/);
  assert.match(page, /does not automatically receive account, funding, payment, invoice, or transaction records/);
  assert.match(page, /Funding Instructions section reloads your saved instructions/);
  assert.doesNotMatch(page, /support workflow the account context needed/);
  assert.match(page, /\/brand-logo/);
});

test('My Asset Vault reloads persistent funding instructions', async () => {
  const script = await readFile(fundingUiPath, 'utf8');
  assert.match(script, /\/api\/access\/funding\/instructions/);
  assert.match(script, /Funding Instructions/);
  assert.match(script, /loadInstructions\(host\)/);
  assert.match(script, /externalReference/);
});

test('public support page has dedicated responsive styling', async () => {
  const css = await readFile(cssPath, 'utf8');
  assert.match(css, /\.support-card/);
  assert.match(css, /\.two-column/);
  assert.match(css, /@media/);
});
