import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const commitmentRouter = fs.readFileSync(new URL('../routes/funding-marketplace-commitment-router.js', import.meta.url), 'utf8');
const allocationRouter = fs.readFileSync(new URL('../routes/funding-marketplace-allocation-router.js', import.meta.url), 'utf8');
const settlementRouter = fs.readFileSync(new URL('../routes/funding-marketplace-settlement-router.js', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../public/admin/admin-marketplace-stage-actions.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');

test('marketplace service routers normalize direct production mount prefixes', () => {
  assert.match(commitmentRouter, /prefix = '\/api\/funding-marketplace-commitment'/);
  assert.match(allocationRouter, /prefix = '\/api\/funding-marketplace-allocation'/);
  assert.match(settlementRouter, /prefix = '\/api\/funding-marketplace-settlement'/);
  for (const source of [commitmentRouter, allocationRouter, settlementRouter]) {
    assert.match(source, /router\.use\(normalizeDirectMount\)/);
    assert.match(source, /req\.url = req\.url\.slice\(prefix\.length\)/);
  }
});

test('marketplace stage actions are explicitly loaded and mounted after lifecycle reader', () => {
  const lifecycleIndex = bootstrap.indexOf('/admin/admin-marketplace-lifecycle-workstation.js');
  const actionsIndex = bootstrap.indexOf('/admin/admin-marketplace-stage-actions.js');
  assert.ok(lifecycleIndex >= 0);
  assert.ok(actionsIndex > lifecycleIndex);
  assert.match(bootstrap, /mountAdminMarketplaceStageActions\?\.\(marketplaceWorkspace\)/);
  assert.match(actions, /window\.mountAdminMarketplaceStageActions=mount/);
  assert.doesNotMatch(actions, /MutationObserver/);
});

test('all eight Marketplace lifecycle tabs own their real next-stage behavior', () => {
  for (const tab of ['Prepared','Ready','Published','Orders','Reservations','Allocations','Settlement','Historical Listings']) {
    assert.match(actions, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(actions, /authorize-readiness/);
  assert.match(actions, /publish-ready/);
  assert.match(actions, /open-window/);
  assert.match(actions, /close-window/);
  assert.match(actions, /confirm-commitment/);
  assert.match(actions, /cancel-commitment/);
  assert.match(actions, /start-allocation-review/);
  assert.match(actions, /approve-allocation/);
  assert.match(actions, /create-positions/);
  assert.match(actions, /prepare-settlement/);
  assert.match(actions, /start-settlement-review/);
  assert.match(actions, /authorize-settlement/);
  assert.match(actions, /verify-confirmation/);
  assert.match(actions, /settle-authorization/);
});

test('marketplace actions use the existing funding lifecycle APIs instead of inventing a second engine', () => {
  assert.match(actions, /\/api\/admin\/listing-readiness-batch\/approve/);
  assert.match(actions, /\/api\/admin\/listing-publication-batch\/approve/);
  assert.match(actions, /\/api\/funding-marketplace-commitment\/listings/);
  assert.match(actions, /\/api\/funding-marketplace-allocation\/windows/);
  assert.match(actions, /\/api\/funding-marketplace-settlement\/preparations/);
  assert.doesNotMatch(actions, /NEW_MARKETPLACE_ENGINE/);
});

test('participant commitments are not fabricated by administration', () => {
  assert.doesNotMatch(actions, /windows\/\$\{[^}]+\}\/commitments`,\{participantId/);
  assert.match(actions, /Participant commitments originate from the marketplace/);
});
