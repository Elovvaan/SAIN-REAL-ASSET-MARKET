import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const index = read('../public/index.html');
const bootstrap = read('../public/public-bootstrap.js');
const participantBootstrap = read('../public/participant-workspace-bootstrap.js');
const participantSuite = read('../public/participant-workspace-suite.js');
const app = read('../public/app.js');

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

test('public bootstrap keeps one participant bootstrap and retires redundant signed-in routers', () => {
  assert.match(bootstrap, /'\/participant-workspace-bootstrap\.js'/);
  for (const retired of ['/workspace-shell.js','/workspace-panel-routing.js','/current-workspace-market.js']) {
    assert.doesNotMatch(bootstrap, new RegExp(retired.replaceAll('/', '\\/').replaceAll('.', '\\.')));
  }
  assert.match(bootstrap, /for \(const source of FEATURES\) await loadScript\(source\)/);
  assert.match(bootstrap, /sra:public-booted/);
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

test('legacy app remains loaded only as a public compatibility surface for this checkpoint', () => {
  assert.match(bootstrap, /'\/app\.js'/);
  assert.match(app, /function renderMarketplace\(\)/);
  assert.match(app, /fetch\('\/api\/marketplace'\)/);
  assert.match(participantSuite, /event\.stopImmediatePropagation\(\)/);
});
