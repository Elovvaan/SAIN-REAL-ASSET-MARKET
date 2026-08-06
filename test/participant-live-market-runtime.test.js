import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const marketUi = fs.readFileSync(new URL('../public/transaction-market-ui.js', import.meta.url), 'utf8');
const syncUi = fs.readFileSync(new URL('../public/live-market-publication-sync.js', import.meta.url), 'utf8');

test('participant marketplace requests and retains LIVE listings only', () => {
  assert.match(marketUi, /state=LIVE/);
  assert.match(marketUi, /status === 'LIVE'/);
  assert.match(marketUi, /\['PUBLISHED', 'ACTIVE'\]/);
  assert.doesNotMatch(marketUi, /All states/);
  assert.doesNotMatch(marketUi, /Prepared<\/span>/);
  assert.doesNotMatch(marketUi, /Ready<\/span>/);
});

test('participant marketplace avoids duplicate startup and aggressive refreshes', () => {
  assert.match(syncUi, /REFRESH_INTERVAL_MS = 60000/);
  assert.doesNotMatch(syncUi, /setTimeout\(refreshPublishedInventory, 800\)/);
  assert.doesNotMatch(syncUi, /marketplaceStatus/);
  assert.match(marketUi, /Date\.now\(\) - marketState\.refreshedAt\.getTime\(\) < 10_000/);
});
