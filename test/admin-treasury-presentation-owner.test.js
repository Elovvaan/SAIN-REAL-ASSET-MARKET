import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const owner = fs.readFileSync(new URL('../public/admin/admin-treasury-presentation-owner.js', import.meta.url), 'utf8');

test('Treasury presentation owner is explicitly loaded after the Treasury workstation', () => {
  const workstationIndex = bootstrap.indexOf('/admin/admin-treasury-workstation.js');
  const ownerIndex = bootstrap.indexOf('/admin/admin-treasury-presentation-owner.js');
  assert.ok(workstationIndex >= 0);
  assert.ok(ownerIndex > workstationIndex);
  assert.match(bootstrap, /mountAdminTreasuryPresentationOwner\?\.\(treasuryWorkspace\)/);
});

test('legacy Treasury controls only belong to Commercial Instruments and Journal Entries', () => {
  assert.match(owner, /tab === 'Commercial Instruments'/);
  assert.match(owner, /tab === 'Journal Entries'/);
  assert.match(owner, /Deposit platform commercial instrument/);
  assert.match(owner, /Post balanced entry/);
  assert.match(owner, /canonicalRecognized/);
});

test('dedicated Treasury workstation suppresses unrelated legacy cards and generic dumps', () => {
  assert.match(owner, /data-treasury-workstation-card/);
  assert.match(owner, /child\.hidden = true/);
  assert.match(owner, /admin-workspace-records/);
  assert.match(owner, /hasUsefulDetail/);
  assert.doesNotMatch(owner, /MutationObserver/);
  assert.doesNotMatch(owner, /setInterval/);
});

test('detail records remain visible where they add operational value', () => {
  for (const tab of ['Commercial Instruments','Journal Entries','Ledger','Treasury Wallets','Treasury Reports']) {
    assert.match(owner, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
