import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const marketplace = fs.readFileSync(new URL('../public/marketplace-tier-one.js', import.meta.url), 'utf8');

test('SRA Coin order action opens a dedicated order workflow', () => {
  assert.match(marketplace, /openCoinOrderWorkflow/);
  assert.match(marketplace, /\/api\/financial-records\/coin-positions/);
  assert.match(marketplace, /\/api\/access\/vault/);
  assert.match(marketplace, /Coin order workflow/);
  assert.match(marketplace, /Order cannot be submitted until/);
  assert.doesNotMatch(marketplace, /review-coin-access[^\n]+askSain/);
});
