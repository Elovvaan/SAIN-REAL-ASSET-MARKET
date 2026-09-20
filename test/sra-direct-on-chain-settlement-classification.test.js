import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('public status recognizes direct SRA transfer as on-chain settlement', () => {
  const router = read('routes/access-router.js');
  assert.match(router, /phase: 'VERIFIED_ASSET_SETTLEMENT'/);
  assert.match(router, /id:'ON_CHAIN_SETTLEMENT'/);
  assert.match(router, /Issued SRA is ready for direct wallet settlement/);
  assert.doesNotMatch(router, /id:'SRAUSD_USDC_LIQUIDITY'/);
});

test('admin keeps exchange controls separate from direct SRA settlement', () => {
  const controls = read('public/admin/admin-on-chain-issuance-controls.js');
  assert.match(controls, /Step 7 · Settle SRA On Chain/);
  assert.match(controls, /Network confirmation completes the direct on-chain SRA settlement/);
  assert.match(controls, /Holder Value Realization/);
  assert.match(controls, /holder may use supported platform services or initiate a later transfer or exchange through an available market/);
  assert.match(controls, /Market activity establishes its own price and liquidity outside the completed SRA settlement/);
  assert.doesNotMatch(controls, /\$\{nativeMarket\}\$\{usdcPreparation\}\$\{usdcConversion\}/);
});

test('public and agent language separate settlement from holder-directed value realization', () => {
  const home = read('public/public-home.js');
  const agent = read('services/sra-agent-service.js');
  const capital = read('services/capital-activation-agent-service.js');
  assert.match(home, /Receive SRA Coin through confirmed settlement, use supported platform services, or enter an available holder-directed market/);
  assert.match(home, /Control settled SRA Coin/);
  assert.match(agent, /Holders realize value through holder-directed market trading and supported platform services/);
  assert.match(agent, /Mandatory distributions, platform buybacks, and platform-funded conversions remain outside the SRA settlement flow/);
  assert.match(capital, /Any later exchange is initiated by the holder through an available market/);
  assert.doesNotMatch(capital, /prepared USDC route remains an optional holder exchange/);
});

test('treasury view retains the financed position instead of offering holder conversion', () => {
  const treasury = read('public/admin/admin-treasury-workstation.js');
  assert.match(treasury, /SRA HOLDINGS & SERVICING/);
  assert.match(treasury, /retains the resulting financed position/);
  assert.doesNotMatch(treasury, /<form data-usdc-conversion-form/);
});
