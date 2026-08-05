import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync(new URL('../public/admin/listing-authorization-ui.js', import.meta.url), 'utf8');
const market = fs.readFileSync(new URL('../public/live-market-publication-sync.js', import.meta.url), 'utf8');

test('admin exposes a verified full market cycle authorization', () => {
  assert.match(admin, /Authorize Current Market Cycle/);
  assert.match(admin, /listing-readiness-batch\/approve/);
  assert.match(admin, /listing-publication-batch\/approve/);
  assert.match(admin, /Verified LIVE|verified LIVE/);
});

test('market uses complete state totals instead of first-page counts', () => {
  assert.match(market, /marketplace-listings\/status/);
  assert.match(market, /status\.byState\?\.PUBLISHED/);
  assert.match(market, /Header totals represent the complete marketplace/);
});

test('buy and sell controls prepare a non-executing SAIN order review', () => {
  assert.match(market, /orderSide = 'BUY'/);
  assert.match(market, /Prepare a \$\{orderSide\} order review/);
  assert.match(market, /Do not execute the order/);
  assert.match(market, /#send-message/);
});
