import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const index = read('../public/index.html');
const bootstrap = read('../public/public-bootstrap.js');
const participantSuite = read('../public/participant-workspace-suite.js');

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

test('public bootstrap preserves the established feature order for the baseline checkpoint', () => {
  const order = [
    '/sane-skills.js','/app.js','/sane-chat-format.js','/interoperability.js','/onboarding.js','/custody.js','/access.js','/sra-authenticated-fetch.js','/participation.js','/marketplace-tier-one.js','/current-workspace-market.js','/platform-admin-workspace.js','/account-capacities.js','/public-home.js','/workspace-shell.js','/workspace-panel-routing.js','/home-project-workspace.js','/institution-workspace-loader.js','/transaction-market-ui.js','/order-intent-ui.js','/live-market-publication-sync.js','/live-asset-vault.js','/funding-intake-ui.js','/funding-operations-ui.js','/funding-verification-desk.js','/funding-value-model-desk.js','/funding-instrument-desk.js','/sain-operations-intelligence.js','/funding-market-activation-desk.js','/verified-settlement-desk.js'
  ];
  let previous = -1;
  for (const source of order) {
    const current = bootstrap.indexOf(`'${source}'`);
    assert.ok(current > previous, `${source} must preserve its current relative load order`);
    previous = current;
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
  assert.match(participantSuite, /const OWNED_VIEWS = new Set/);
  assert.match(participantSuite, /function renderOwnedView\(view\)/);
  assert.match(participantSuite, /#view-root/);
  assert.match(participantSuite, /#sane-workspace-title/);
  assert.match(participantSuite, /#quick-prompts/);
});

test('baseline keeps compatibility routers visible for later retirement rather than silently deleting them', () => {
  for (const source of ['/app.js','/workspace-shell.js','/workspace-panel-routing.js','/current-workspace-market.js']) {
    assert.match(bootstrap, new RegExp(source.replaceAll('/', '\\/').replaceAll('.', '\\.')));
  }
});
