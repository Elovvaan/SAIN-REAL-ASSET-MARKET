import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('financing export settlement transfers SRA and creates the retained financed position', () => {
  const router = read('routes/on-chain-projection-router.js');
  assert.match(router, /exportPackageId/);
  assert.match(router, /FINANCING_DISBURSEMENT/);
  assert.match(router, /Financing settlement records are incomplete for retained-position creation/);
  assert.match(router, /Issued SRA Coin representation was not found/);
  assert.match(router, /financingClosingService\.recordSettlement/);
  assert.match(router, /recipientPaid:transfer\.state === 'CONFIRMED'/);
  assert.match(router, /retainedPosition/);
});

test('on-chain settlement UI does not ask SRA to provide USD or USDC', () => {
  const ui = read('public/admin/admin-settlement-execution-controls.js');
  assert.match(ui, /Settlement asset<\/span><input name="asset" value="SRA" readonly/);
  assert.match(ui, /Financing export package/);
  assert.doesNotMatch(ui, /const bankRails = new Set\(\[[^\]]*STELLAR_USDC/);
});

test('confirmed financing settlement retains the position inside SRA', () => {
  const closing = read('services/financing-closing-service.js');
  assert.match(closing, /ownerId: 'SRA'/);
  assert.match(closing, /distributionStatus: 'RETAINED'/);
  assert.match(closing, /FINANCED_POSITION_CREATED_FROM_FUNDED_FINANCING/);
});
