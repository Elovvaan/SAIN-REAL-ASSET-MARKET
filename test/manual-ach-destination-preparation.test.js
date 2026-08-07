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

test('admin loader installs the Destination Verification control after the workspace shell', () => {
  const loader = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');
  const shellIndex = loader.indexOf('/admin/admin-suite-shell.js');
  const destinationIndex = loader.indexOf('/admin/admin-settlement-destination.js');
  assert.ok(shellIndex >= 0);
  assert.ok(destinationIndex > shellIndex);

  const control = fs.readFileSync(new URL('../public/admin/admin-settlement-destination.js', import.meta.url), 'utf8');
  assert.match(control, /Destination Verification/);
  assert.match(control, /\/api\/admin\/treasury-transfer-readiness\/ach\/prepare/);
  assert.match(control, /Routing and account numbers are used only for this preparation request/);
});
