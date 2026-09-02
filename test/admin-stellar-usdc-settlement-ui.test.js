import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../public/admin/admin-settlement-execution-controls.js', import.meta.url), 'utf8');
const gateway = fs.readFileSync(new URL('../services/settlement-rail-gateway-service.js', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../routes/settlement-rail-gateway-router.js', import.meta.url), 'utf8');

test('admin settlement flow offers governed Circle USDC without replacing dealer package or bank rails', () => {
  assert.match(ui, /Stellar USDC · Circle-issued/);
  assert.match(ui, /Dealer elected Circle-issued USDC on Stellar/);
  assert.match(ui, /confirmMainnetSettlement/);
  assert.match(ui, /execute-stellar-usdc/);
  assert.match(ui, /DEAL_PACKAGE/);
  assert.match(gateway, /STELLAR_PAYMENT/);
  assert.match(gateway, /Cancel it before selecting another settlement rail/);
  assert.match(router, /stellar-usdc\/recipients/);
  assert.match(router, /execute-stellar-usdc/);
});
