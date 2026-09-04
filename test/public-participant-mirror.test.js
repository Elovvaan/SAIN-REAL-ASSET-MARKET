import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const suite = fs.readFileSync(new URL('../public/participant-workspace-suite.js', import.meta.url), 'utf8');

test('public participant suite uses live platform reads', () => {
  assert.match(suite, /api\/participation\/positions/);
  assert.match(suite, /api\/access\/vault/);
  assert.match(suite, /api\/marketplace-listings\?state=LIVE&limit=100/);
  assert.match(suite, /api\/financial-records\/coin-positions/);
});

test('marketplace is based on live published listings', () => {
  assert.match(suite, /PUBLISHED/);
  assert.match(suite, /View published marketplace products and available actions/);
  assert.match(suite, /Current live products/);
});

test('coin view separates network totals from participant-linked positions', () => {
  assert.match(suite, /View your SRA position and current network totals/);
  assert.match(suite, /belongsToParticipant/);
  assert.match(suite, /Your available SRA/);
  assert.match(suite, /derivative or segmented slices/);
});

test('participant suite adds no observer or polling layer', () => {
  assert.doesNotMatch(suite, /MutationObserver/);
  assert.doesNotMatch(suite, /setInterval/);
});
