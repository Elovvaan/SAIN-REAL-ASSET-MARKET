import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('platform funding instrument deposit production integration is present', () => {
  const service = fs.readFileSync(new URL('../services/platform-funding-instrument-deposit-service.js', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../routes/treasury-admin-routes.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/admin/treasury-ledger-ui.js', import.meta.url), 'utf8');
  assert.match(service, /DEPOSITED_RECOGNIZED_USD/);
  assert.match(service, /AVAILABLE_FOR_GOVERNED_FINANCING/);
  assert.match(service, /domain\.atomicPut/);
  assert.match(routes, /funding-instrument-deposits\/approve/);
  assert.match(ui, /Deposit & Establish USD Position/);
});
