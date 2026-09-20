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
  assert.match(controls, /Optional Post-Settlement Exchange · SRA \/ USDC Market/);
  assert.match(controls, /Direct SRA issuance and wallet settlement do not use this step/);
});

test('treasury USDC acquisition is identified as a separate operation', () => {
  const treasury = read('public/admin/admin-treasury-workstation.js');
  assert.match(treasury, /SEPARATE TREASURY OPERATION/);
  assert.match(treasury, /separate from direct SRA Coin issuance and on-chain settlement/);
});
