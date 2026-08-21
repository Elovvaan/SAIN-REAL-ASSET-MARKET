import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const index = read('../public/index.html');
const bootstrap = read('../public/public-bootstrap.js');
const participantBootstrap = read('../public/participant-workspace-bootstrap.js');
const participantSuite = read('../public/participant-workspace-suite.js');
const chatRuntime = read('../public/public-chat-runtime.js');
const access = read('../public/access.js');
const fundingOperations = read('../public/funding-operations-ui.js');

test('public index delegates JavaScript ownership to one bootstrap', () => {
  assert.match(index, /<script src="\/public-bootstrap\.js" defer><\/script>/);
  for (const source of [
    '/app.js',
    '/workspace-shell.js',
    '/workspace-panel-routing.js',
    '/participant-workspace-suite.js',
    '/funding-intake-ui.js',
    '/funding-operations-ui.js',
    '/verified-settlement-desk.js',
  ]) {
    assert.doesNotMatch(index, new RegExp(`<script[^>]+src=["']${source.replaceAll('/', '\\/').replaceAll('.', '\\.')}["']`));
  }
});

test('public bootstrap keeps one participant bootstrap and preserves marketplace renderer dependency order', () => {
  assert.match(bootstrap, /'\/participant-workspace-bootstrap\.js'/);
  for (const retired of ['/app.js','/workspace-shell.js','/workspace-panel-routing.js','/current-workspace-market.js']) {
    assert.doesNotMatch(bootstrap, new RegExp(retired.replaceAll('/', '\\/').replaceAll('.', '\\.')));
  }
  assert.match(bootstrap, /'\/public-chat-runtime\.js'/);
  assert.match(bootstrap, /Promise\.all\(CORE_PARALLEL_FEATURES\.map\(loadScript\)\)/);
  assert.match(bootstrap, /await loadScript\('\/participation\.js'\);\s*await loadScript\('\/marketplace-tier-one\.js'\);/);
  assert.ok(bootstrap.indexOf("await loadScript('/participation.js')") < bootstrap.indexOf("await loadScript('/marketplace-tier-one.js')"));
  assert.match(bootstrap, /sra:public-booted/);
});

test('access.js is the sole access and capability shell owner', () => {
  assert.match(bootstrap, /'\/access\.js'/);
  assert.doesNotMatch(bootstrap, /'\/account-capacities\.js'/);
  assert.match(access, /function renderAccessControls\(\)/);
  assert.match(access, /function renderCapabilities\(\)/);
  assert.match(access, /async function applyCapacity\(capacity\)/);
  assert.match(access, /async function activateCapacity\(capacity\)/);
  assert.match(access, /function configureNavigation\(\)/);
  assert.match(access, /function applyAccessShell\(\)/);
  assert.match(access, /async function initializeAccess\(\)/);
});

test('current signed-in participant shell contract is explicit and stable', () => {
  const expected = [
    ['home-projects', 'Home'],
    ['marketplace', 'Marketplace'],
    ['instruments', 'Create Instrument'],
    ['funding-operations', 'Financing'],
    ['positions', 'My Positions'],
    ['custody', 'Asset Vault'],
    ['activity', 'Transactions'],
    ['assets', 'SRA Coin'],
    ['pools', 'Predictions / Liquidity'],
    ['participants', 'Account'],
  ];
  for (const [view, label] of expected) {
    assert.match(participantSuite, new RegExp(`\\['${view}', \\['[^']*', '${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\]\\]`));
  }
  assert.match(participantSuite, /const OWNED_VIEWS = new Set\(ORDER\)/);
  assert.match(participantSuite, /function renderOwnedView\(view\)/);
  assert.match(participantSuite, /event\.stopImmediatePropagation\(\)/);
  assert.match(participantSuite, /#view-root/);
  assert.match(participantSuite, /#sane-workspace-title/);
  assert.match(participantSuite, /#quick-prompts/);
});

test('participant lifecycle is driven by explicit access-state events, not DOM observers', () => {
  assert.match(participantBootstrap, /sra:access-state-changed/);
  assert.match(participantSuite, /window\.addEventListener\('sra:access-state-changed', sync\)/);
  assert.doesNotMatch(participantBootstrap, /MutationObserver/);
  assert.doesNotMatch(participantBootstrap, /window\.MutationObserver/);
  assert.doesNotMatch(participantSuite, /new MutationObserver/);
  assert.doesNotMatch(participantSuite, /observer\.observe/);
});

test('participant bootstrap is the sole signed-in shell loader', () => {
  assert.match(participantBootstrap, /participant-workspace-suite\.js/);
  assert.match(participantBootstrap, /sra:access-state-changed/);
  assert.doesNotMatch(bootstrap, /workspace-shell-core\.js/);
});

test('signed-in marketplace is owned by the participant suite', () => {
  assert.match(participantSuite, /marketplace: \['Marketplace', 'LIVE'\]/);
  assert.match(participantSuite, /fetch\('\/api\/marketplace', \{ cache: 'no-store' \}\)/);
  assert.match(participantSuite, /async function renderMarketplace\(root\)/);
  assert.match(participantSuite, /if \(view === 'marketplace'\) void renderMarketplace\(root\)/);
  assert.match(participantSuite, /data-participant-prompt/);
  assert.doesNotMatch(participantSuite, /ORDER\.filter\(\(view\) => view !== 'marketplace'\)/);
});

test('signed-in Asset Vault is owned by the participant suite', () => {
  assert.doesNotMatch(bootstrap, /'\/live-asset-vault\.js'/);
  assert.match(participantSuite, /async function renderAssetVault\(root\)/);
  assert.match(participantSuite, /fetch\('\/api\/access\/vault'/);
  assert.match(participantSuite, /if \(view === 'custody'\) void renderAssetVault\(root\)/);
  assert.match(participantSuite, /Participant-linked activity/);
  assert.match(participantSuite, /Recorded account balance/);
  assert.match(participantSuite, /OWNER CONTROLLED/);
});

test('Financing is participant-owned and the funding module is a capability renderer only', () => {
  assert.match(bootstrap, /'\/funding-operations-ui\.js'/);
  assert.match(participantSuite, /view === 'funding-operations'/);
  assert.match(participantSuite, /window\.renderParticipantFundingOperations\(root\)/);
  assert.match(fundingOperations, /window\.renderParticipantFundingOperations = render/);
  assert.match(fundingOperations, /\/api\/funding-operations\/dashboard/);
  assert.match(fundingOperations, /\/api\/funding\/opportunities/);
  assert.doesNotMatch(fundingOperations, /MutationObserver/);
  assert.doesNotMatch(fundingOperations, /data-view="funding-operations"/);
  assert.doesNotMatch(fundingOperations, /querySelectorAll\('\.nav-item'\)/);
  assert.doesNotMatch(fundingOperations, /DOMContentLoaded/);
});

test('shared public chat runtime owns chat without owning participant views', () => {
  assert.match(chatRuntime, /fetch\('\/api\/sane\/agent\/chat'/);
  assert.match(chatRuntime, /document\.querySelector\('\.nav-item\.active'\)\?\.dataset\.view/);
  assert.match(chatRuntime, /includeTrialBalance: view === 'activity'/);
  assert.match(chatRuntime, /#send-message/);
  assert.match(chatRuntime, /#sane-input/);
  assert.doesNotMatch(chatRuntime, /#view-root/);
  assert.doesNotMatch(chatRuntime, /renderMarketplace/);
  assert.doesNotMatch(chatRuntime, /querySelectorAll\('\.nav-item'\).*addEventListener/);
});
