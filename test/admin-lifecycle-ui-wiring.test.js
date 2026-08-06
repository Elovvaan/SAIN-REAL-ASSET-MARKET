import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const authorization = fs.readFileSync(new URL('../public/admin/listing-authorization-ui.js', import.meta.url), 'utf8');
const operations = fs.readFileSync(new URL('../public/admin/operations-queue-ui.js', import.meta.url), 'utf8');

test('dynamically injected administration modules initialize after DOMContentLoaded', () => {
  assert.match(authorization, /document\.readyState === 'loading'/);
  assert.match(authorization, /else initialize\(\)/);
  assert.match(operations, /document\.readyState === 'loading'/);
  assert.match(operations, /else initialize\(\)/);
});

test('administration presents the canonical SRA\/USD publication lifecycle', () => {
  assert.match(authorization, /SRA\/USD Market Lifecycle/);
  assert.match(authorization, /state: PUBLISHED/);
  assert.match(authorization, /status: LIVE/);
  assert.match(authorization, /Advance Current Eligible Set/);
  assert.match(authorization, /listing-publication-batch\/approve/);
});

test('operations queue and Coin intelligence mount into production administration', () => {
  assert.match(operations, /Unified Market Operations Queue/);
  assert.match(operations, /SRA Coin Intelligence/);
  assert.match(operations, /\/api\/sane\/operations-queue/);
  assert.match(operations, /\/api\/sane\/coin-agents/);
});
