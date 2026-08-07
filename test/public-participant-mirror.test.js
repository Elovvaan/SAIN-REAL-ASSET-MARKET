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
  assert.match(suite, /prepared listings remain out of this view until they become a published product/);
  assert.match(suite, /Feature state does not imply products exist/);
});

test('coin view separates network totals from participant-linked positions', () => {
  assert.match(suite, /Network representation and your account ownership are separate facts/);
  assert.match(suite, /belongsToParticipant/);
  assert.match(suite, /Your linked SRA/);
  assert.match(suite, /Derivatives do not create new supply/);
});

test('participant suite adds no observer or polling layer', () => {
  assert.doesNotMatch(suite, /MutationObserver/);
  assert.doesNotMatch(suite, /setInterval/);
});
