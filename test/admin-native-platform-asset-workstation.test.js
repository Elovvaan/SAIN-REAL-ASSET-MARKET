import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const workstation = fs.readFileSync(new URL('../public/admin/admin-native-platform-asset-workstation.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');

test('Native Platform Asset workstation loads and mounts explicitly', () => {
  assert.match(bootstrap, /admin-native-platform-asset-workstation\.js/);
  assert.match(bootstrap, /mountAdminNativePlatformAssetWorkstation\?\.\(admin\.querySelector\('\[data-workspace="native-asset"\]'\)\)/);
  assert.match(workstation, /window\.mountAdminNativePlatformAssetWorkstation = mount/);
  assert.doesNotMatch(workstation, /MutationObserver/);
  assert.doesNotMatch(workstation, /DOMContentLoaded/);
});

test('all Native Platform Asset tabs render distinct lifecycle summaries', () => {
  for (const title of ['Current Asset','Approval Status','Listing','Marketplace Status','Export Status','Ownership','Recognitions','Asset History','Publishing','Governance']) {
    assert.match(workstation, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(workstation, /Export boundary/);
  assert.match(workstation, /Ownership recognition/);
  assert.match(workstation, /Lifecycle events/);
  assert.match(workstation, /Publication state/);
});

test('workstation uses canonical platform-asset status and workspace lifecycle records', () => {
  assert.match(workstation, /\/api\/admin\/platform-asset/);
  assert.match(workstation, /\/api\/admin\/workspaces\?limit=100/);
  assert.match(workstation, /marketplaceListings/);
  assert.match(workstation, /ownershipRecognitions/);
  assert.match(workstation, /exportPackages/);
  assert.match(workstation, /settlementRecords/);
  assert.match(workstation, /lifecycleEvents/);
});

test('legacy repeated native summary is removed from tab controls', () => {
  assert.match(workstation, /removeLegacySummary/);
  assert.match(workstation, /Approve & Publish\|Asset code\|Export boundary/);
});

test('existing native tabs remain canonical navigation contract', () => {
  for (const tab of ['Current Asset','Approval Status','Listing','Marketplace Status','Export Status','Ownership','Recognitions','Asset History','Publishing','Governance']) {
    assert.match(shell, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
