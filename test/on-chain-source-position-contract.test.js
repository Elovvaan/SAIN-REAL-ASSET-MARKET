import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/on-chain-projection-router.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/admin/admin-xrpl-exchange-workstation.js', import.meta.url), 'utf8');

test('on-chain issuance requires and validates available SRA Coin Position supply', () => {
  assert.match(router, /sourcePositionId is required/);
  assert.match(router, /position\?\.denomination\?\.symbol/);
  assert.match(router, /\['SRA','SRAUSD'\]/);
  assert.match(router, /Source Coin Position must use the canonical SRA or SRA\/USD denomination/);
  assert.match(router, /Issuance amount exceeds the source Coin Position/);
  assert.match(router, /ON_CHAIN_ISSUANCE_SOURCE/);
  assert.match(router, /COIN_POSITION_EXTERNALIZED_ON_CHAIN/);
  assert.match(router, /domain\.atomicPut/);
});

test('XRPL interface selects existing native or Coinbase-derived Coin Position source', () => {
  assert.match(ui, /\/api\/on-chain\/source-positions/);
  assert.match(ui, /Source Coin Position/);
  assert.match(ui, /sourcePositionId/);
  assert.match(ui, /externalize the entered quantity from the selected Coin Position/);
});
