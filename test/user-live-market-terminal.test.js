import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../public/transaction-market-ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/transaction-market-ui.css', import.meta.url), 'utf8');

test('user marketplace reads canonical marketplace listings', () => {
  assert.match(ui, /\/api\/marketplace-listings\?state=LIVE&page=1&limit=100/);
  assert.match(ui, /SRA Market Instruments/);
  assert.match(ui, /Market Watch/);
  assert.match(ui, /Market Depth/);
  assert.match(ui, /Order Ticket/);
});

test('terminal does not directly execute an order', () => {
  assert.doesNotMatch(ui, /fetch\([^\n]*order/i);
  assert.match(ui, /Review and confirm your order/);
  assert.match(ui, /Review Order with SAIN/);
});

test('terminal has responsive trading workspace layout', () => {
  assert.match(css, /terminal-grid/);
  assert.match(css, /market-chart/);
  assert.match(css, /@media\(max-width:850px\)/);
});
