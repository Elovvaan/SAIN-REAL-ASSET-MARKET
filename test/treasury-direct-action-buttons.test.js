import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../public/admin/treasury-ledger-ui.js', import.meta.url), 'utf8');

test('treasury primary actions are not permanently disabled behind preview buttons', () => {
  assert.doesNotMatch(ui, /id=\"funding-instrument-approve\"[^>]*disabled/);
  assert.doesNotMatch(ui, /id=\"treasury-post\"[^>]*disabled/);
});

test('deposit action performs preview automatically before approval', () => {
  assert.match(ui, /depositPreview\|\|await previewFundingInstrument\(\)/);
  assert.match(ui, /funding-instrument-deposits\/approve/);
});

test('balanced-entry action performs preview automatically before approval', () => {
  assert.match(ui, /entryPreview\|\|previewEntry\(\)/);
  assert.match(ui, /treasury\/journals\/approve/);
});
