import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../public/admin/admin-settlement-execution-controls.js', import.meta.url), 'utf8');
const gateway = fs.readFileSync(new URL('../services/settlement-rail-gateway-service.js', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../routes/settlement-rail-gateway-router.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const moneyGram = fs.readFileSync(new URL('../public/admin/admin-moneygram-sandbox-test.js', import.meta.url), 'utf8');

test('admin settlement flow offers the instrument path and SRA Coin while preserving the inactive USDC integration', () => {
  assert.match(ui, /const bankRails = new Set\(\['ACH','FEDWIRE','WIRE'\]\)/);
  assert.match(ui, /SRA Coin on-chain/);
  assert.match(ui, /Settle with SRA Coin/);
  assert.match(ui, /A confirmed SRA transfer pays the recipient/);
  assert.match(ui, /DEAL_PACKAGE/);
  assert.match(gateway, /STELLAR_PAYMENT/);
  assert.match(gateway, /Cancel it before selecting another settlement rail/);
  assert.match(router, /stellar-usdc\/recipients/);
  assert.match(router, /execute-stellar-usdc/);
});

test('MoneyGram certification tests live in Export and Settlement as sandbox evidence', () => {
  assert.match(bootstrap, /settlement:[\s\S]*admin-moneygram-sandbox-test/);
  assert.match(bootstrap, /mountAdminMoneyGramSandboxTest\?\.\(root\)/);
  assert.doesNotMatch(bootstrap, /instruments:[\s\S]{0,300}admin-moneygram-sandbox-test/);
  assert.match(moneyGram, /MoneyGram Ramps Sandbox Certification/);
  assert.match(moneyGram, /CASH_OUT_REFUND/);
  assert.match(moneyGram, /Export Evidence/);
});
