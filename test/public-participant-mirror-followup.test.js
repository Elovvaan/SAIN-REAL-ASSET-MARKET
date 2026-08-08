import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/participant-workspace-suite.js', import.meta.url), 'utf8');

test('participant mirror recognizes SRA across symbol, unit, and denomination fields', () => {
  assert.match(source, /position\?\.symbol \|\| position\?\.unit \|\| position\?\.denomination\?\.symbol/);
  assert.match(source, /coinUnit\(position\) === 'SRA'/);
});

test('participant SRA holdings use spendable quantities so segmentation does not duplicate value', () => {
  assert.match(source, /function participantSpendableSra/);
  assert.match(source, /availableQuantity \?\? position\?\.quantity/);
  assert.match(source, /reduce\(\(sum, item\) => sum \+ participantSpendableSra\(item\), 0\)/);
});

test('participant endpoint reads are isolated instead of all-or-nothing', () => {
  assert.match(source, /Promise\.allSettled\(/);
  assert.match(source, /errors:\s*\{/);
  for (const key of ['positions', 'vault', 'listings', 'coin']) assert.match(source, new RegExp(`${key}: settledError`));
});

test('async error paths stop when the participant navigates away', () => {
  for (const view of ['home-projects', 'positions', 'activity', 'assets', 'custody', 'marketplace']) {
    assert.match(source, new RegExp(`if \\(activeView !== '${view}'\\) return;`));
  }
});