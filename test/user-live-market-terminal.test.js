import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../public/transaction-market-ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/transaction-market-ui.css', import.meta.url), 'utf8');

test('user marketplace reads canonical marketplace listings', () => {
  assert.match(ui, /\/api\/marketplace-listings\?page=1&limit=100/);
  assert.match(ui, /Transaction-Backed Instruments/);
  assert.match(ui, /Market Watch/);
  assert.match(ui, /Market Depth/);
  assert.match(ui, /Order Ticket/);
});

test('terminal does not directly execute an order', () => {
  assert.doesNotMatch(ui, /fetch\([^\n]*order/i);
  assert.match(ui, /No order executes from this screen without the authorized participation and confirmation workflow/);
  assert.match(ui, /Review Order with SAIN/);
});

test('terminal has responsive trading workspace layout', () => {
  assert.match(css, /terminal-grid/);
  assert.match(css, /market-chart/);
  assert.match(css, /@media\(max-width:850px\)/);
});