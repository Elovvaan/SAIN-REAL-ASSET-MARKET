import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const treasury = fs.readFileSync(new URL('../public/admin/admin-treasury-workstation.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');

test('Treasury workstation is explicitly loaded and mounted', () => {
  assert.match(bootstrap, /admin-treasury-workstation\.js/);
  assert.match(bootstrap, /mountAdminTreasuryWorkstation\?\.\(admin\.querySelector\('\[data-workspace="treasury"\]'\)\)/);
  assert.match(treasury, /window\.mountAdminTreasuryWorkstation = mount/);
  assert.doesNotMatch(treasury, /MutationObserver/);
  assert.doesNotMatch(treasury, /DOMContentLoaded/);
});

test('Treasury tabs own distinct operational summaries', () => {
  for (const title of ['Treasury Position','Commercial Instruments','Cash Position','Available Financing','Funding Capacity','Journal Entries','Treasury Wallets','Treasury Ledger','Treasury Reports']) {
    assert.match(treasury, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(treasury, /Held for payments/);
  assert.match(treasury, /Available to send/);
  assert.match(treasury, /In-flight payments/);
  assert.match(treasury, /Committed \/ unavailable/);
});

test('Cash Position initiates payment and hands off to Destination Verification', () => {
  assert.match(treasury, /data-treasury-payment-form/);
  assert.match(treasury, /Send Payment/);
  assert.match(treasury, /sra:treasury-payment-draft/);
  assert.match(treasury, /data-admin-workspace="settlement"/);
  assert.match(treasury, /data-admin-tab="Destination Verification"/);
  assert.match(treasury, /Verify Destination & Prepare Payment/);
  assert.match(treasury, /source: Cash \/ Settlement USD/);
});

test('Treasury workstation uses existing backend capabilities instead of creating a second payment backend', () => {
  assert.match(treasury, /\/api\/admin\/treasury/);
  assert.match(treasury, /\/api\/admin\/treasury-transfer-readiness/);
  assert.match(treasury, /\/api\/admin\/workspaces\?limit=100/);
  assert.doesNotMatch(treasury, /fetch\([^)]*\/execute-one-dollar-canary/);
  assert.doesNotMatch(treasury, /EXTERNAL_TRANSFER_EXECUTION_AUTHORIZATION/);
});

test('existing Treasury tabs remain the canonical navigation contract', () => {
  for (const tab of ['Overview','Commercial Instruments','Cash Position','Available Financing','Funding Capacity','Journal Entries','Treasury Wallets','Ledger','Treasury Reports']) {
    assert.match(shell, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
