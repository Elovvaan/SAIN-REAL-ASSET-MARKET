import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../public/transaction-market-ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/transaction-market-ui.css', import.meta.url), 'utf8');

test('public market identifies the traded market as SRA quoted in USD', () => {
  assert.match(ui, /function marketIdentity/);
  assert.match(ui, /SRA Market Instruments/);
  assert.match(ui, /SRA-denominated marketplace inventory priced in USD/);
  assert.doesNotMatch(ui, /Transaction-Backed Instruments/);
  assert.doesNotMatch(ui, /BTC \/ SRA/);
});

test('record origin is generic and not hardcoded to one provider', () => {
  assert.match(ui, /function recordOrigin/);
  assert.match(ui, /Record Origin/);
  assert.match(ui, /Provider/);
  assert.match(ui, /Connector/);
  assert.match(ui, /Record type/);
  assert.doesNotMatch(ui, /provider:\s*'Coinbase'/);
  assert.doesNotMatch(ui, /Source Market\s*Coinbase/);
});

test('origin panel has responsive terminal layout support', () => {
  assert.match(css, /\.record-origin-panel/);
  assert.match(css, /\.record-origin-grid/);
  assert.match(css, /grid-area:origin/);
});
