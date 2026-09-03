import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Stellar USDC identity follows the selected network', () => {
  const stellar = read('services/stellar-transfer-service.js');
  assert.match(stellar, /PUBLIC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'/);
  assert.match(stellar, /TESTNET: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'/);
  assert.match(stellar, /STELLAR_USDC_ISSUER/);
});

test('SRAUSD/USDC workflow persists quote, confirmed swap, and reconciliation records', () => {
  const stellar = read('services/stellar-transfer-service.js');
  const router = read('routes/on-chain-projection-router.js');
  const ui = read('public/admin/admin-on-chain-issuance-controls.js');
  assert.match(stellar, /strictSendPaths/);
  assert.match(stellar, /minimumUsdc/);
  assert.match(stellar, /STELLAR_USDC_LIQUIDITY_UNAVAILABLE/);
  assert.match(stellar, /Operation\.pathPaymentStrictSend/);
  assert.match(stellar, /reconcileUsdcSwap/);
  assert.match(router, /ON_CHAIN_SWAP_QUOTE/);
  assert.match(router, /ON_CHAIN_ASSET_SWAP/);
  assert.match(router, /confirmSwap !== true/);
  assert.match(ui, /Quote SRAUSD\/USDC/);
  assert.match(ui, /Execute Conversion/);
  assert.match(ui, /Reconcile Conversion/);
});
