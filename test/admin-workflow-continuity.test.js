import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const nativeAsset = fs.readFileSync(new URL('../public/admin/admin-native-platform-asset-workstation.js', import.meta.url), 'utf8');
const treasury = fs.readFileSync(new URL('../public/admin/admin-treasury-workstation.js', import.meta.url), 'utf8');
const records = fs.readFileSync(new URL('../public/admin/admin-financial-records-workstation.js', import.meta.url), 'utf8');

test('Native Platform Asset approval status exposes the existing governed bootstrap action', () => {
  assert.match(nativeAsset, /Approve & Create Native Asset/);
  assert.match(nativeAsset, /\/api\/admin\/platform-asset\/bootstrap/);
  assert.match(nativeAsset, /approval:'APPROVE'/);
  assert.match(nativeAsset, /does not create the separate \$18M Treasury instrument/);
});

test('Treasury surfaces the canonical issued instrument as the next recognition action', () => {
  assert.match(treasury, /funding-instrument-deposits\/eligible-instruments/);
  assert.match(treasury, /Recognize \$\{money\(instrument\.faceValueUsd\)\} in Treasury/);
  assert.match(treasury, /funding-instrument-deposits\/approve/);
  assert.match(treasury, /approval:'APPROVE'/);
  assert.match(treasury, /ISSUED · AWAITING TREASURY RECOGNITION/);
  assert.match(treasury, /Commercial instrument value and financing capacity are not cash/);
});

test('Financial Records has an explicitly mounted readable workstation', () => {
  assert.match(bootstrap, /admin-financial-records-workstation\.js/);
  assert.match(bootstrap, /mountAdminFinancialRecordsWorkstation/);
  assert.match(records, /Observation → Recognition → Financial Record → Coin Position → Instrument/);
  assert.match(records, /function scalar\(value\)/);
  assert.doesNotMatch(records, /\[object Object\]/);
});

test('Financial Records preserves all existing tab stages', () => {
  for (const tab of ['Recognitions','Observations','Financial Records','Evidence','Origin Records','Trace','Audit']) {
    assert.match(records, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
