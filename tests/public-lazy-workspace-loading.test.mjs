import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const bootstrap = fs.readFileSync(new URL('../public/public-bootstrap.js', import.meta.url), 'utf8');
const participant = fs.readFileSync(new URL('../public/participant-workspace-suite.js', import.meta.url), 'utf8');
const participantBootstrap = fs.readFileSync(new URL('../public/participant-workspace-bootstrap.js', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');
const orderIntent = fs.readFileSync(new URL('../public/order-intent-ui.js', import.meta.url), 'utf8');
const fundingIntake = fs.readFileSync(new URL('../public/funding-intake-ui.js', import.meta.url), 'utf8');
const adminIndex = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
const adminBootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');

test('public bootstrap loads workspace capabilities on navigation instead of browser idle', () => {
  assert.match(bootstrap, /const VIEW_FEATURES =/);
  assert.match(bootstrap, /function loadWorkspaceFeatures\(view\)/);
  assert.match(bootstrap, /document\.addEventListener\('click',[\s\S]*loadWorkspaceFeatures\(view\)/);
  assert.doesNotMatch(bootstrap, /requestIdleCallback\(loadDeferred/);
  assert.doesNotMatch(bootstrap, /Promise\.allSettled\(DEFERRED_FEATURES/);
  assert.doesNotMatch(bootstrap, /await loadScript\('\/participation\.js'\)/);
});

test('participant renderer waits for the requested feature and then rerenders one owner', () => {
  assert.match(participant, /SRAPublicFeatures\?\.requires\(view\)/);
  assert.match(participant, /SRAPublicFeatures\.ensure\(view\)/);
  assert.match(participant, /sra:public-workspace-features-ready/);
  assert.match(participant, /renderTransactionMarketSection/);
});

test('authenticated Home gets its visible market module before the participant suite', () => {
  const eventIndex = participantBootstrap.indexOf("loadScript('/event-market.js'");
  const suiteIndex = participantBootstrap.indexOf("loadScript('/participant-workspace-suite.js'");
  assert.ok(eventIndex >= 0 && suiteIndex > eventIndex);
});

test('authenticated access does not request unused signed-out public data', () => {
  assert.match(access, /if\(accessState\.session\)accessState\.publicData=\{opportunities:\[\]\}/);
  assert.match(access, /else\{const publicResponse=await fetch\('\/api\/access\/public'\)/);
});

test('late-loaded observers initialize after DOMContentLoaded', () => {
  for (const source of [orderIntent, fundingIntake]) {
    assert.match(source, /document\.readyState === 'loading'/);
    assert.match(source, /else initialize\(\)/);
  }
});

test('admin settlement integration loads only when Settlement opens', () => {
  assert.doesNotMatch(adminIndex, /admin-treasury-prime-connection-test\.js/);
  assert.match(adminBootstrap, /settlement:\s*\[[\s\S]*admin-treasury-prime-connection-test\.js/);
  assert.match(adminBootstrap, /mountAdminTreasuryPrimeConnectionTest\?\.\(settlement\)/);
});
