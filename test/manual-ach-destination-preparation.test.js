import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareManualAchDestination, validRoutingNumber } from '../routes/treasury-transfer-readiness-routes.js';

test('validates standard ABA routing checksum', () => {
  assert.equal(validRoutingNumber('021000021'), true);
  assert.equal(validRoutingNumber('021000022'), false);
});

test('manual ACH preparation returns only masked and opaque destination data', () => {
  const prepared = prepareManualAchDestination({
    bankName: 'Test Bank',
    routingNumber: '021000021',
    accountNumber: '1234567890',
    accountType: 'CHECKING',
  });
  assert.equal(prepared.label, 'Test Bank ••••7890');
  assert.equal(prepared.accountLast4, '7890');
  assert.equal(prepared.routingLast4, '0021');
  assert.match(prepared.destinationId, /^DST-ACH-/);
  assert.match(prepared.destinationReference, /^ACH-DEST-/);
  const serialized = JSON.stringify(prepared);
  assert.equal(serialized.includes('1234567890'), false);
  assert.equal(serialized.includes('021000021'), false);
});

test('rejects unsupported account types and malformed account values', () => {
  assert.throws(() => prepareManualAchDestination({ routingNumber: '021000021', accountNumber: '123', accountType: 'CHECKING' }), /4 to 17 digits/);
  assert.throws(() => prepareManualAchDestination({ routingNumber: '021000021', accountNumber: '12345678', accountType: 'BROKERAGE' }), /CHECKING or SAVINGS/);
});

test('Destination Verification form is owned natively by the settlement workspace shell', () => {
  const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
  const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
  assert.match(shell, /function achDestinationControlMarkup\(\)/);
  assert.match(shell, /data-native-ach-destination-form/);
  assert.match(shell, /if\(id==='settlement'\) renderSettlementControls\(tab\)/);
  assert.match(shell, /\/api\/admin\/treasury-transfer-readiness\/ach\/prepare/);
  assert.match(shell, /Verify & Prepare Instruction/);
  assert.match(shell, /Routing and account numbers are used only for this preparation request/);
  assert.doesNotMatch(bootstrap, /admin-settlement-destination\.js/);
});
