import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../public/live-asset-vault.js', import.meta.url), 'utf8');

test('application shell loads the live Asset Vault controller after the base transaction UI', () => {
  assert.match(html, /transaction-market-ui\.js/);
  assert.match(html, /live-asset-vault\.js/);
  assert.ok(html.indexOf('transaction-market-ui.js') < html.indexOf('live-asset-vault.js'));
});

test('live Asset Vault fetches the authenticated vault endpoint', () => {
  assert.match(script, /fetch\('\/api\/access\/vault'/);
  assert.match(script, /recordedBalance/);
  assert.match(script, /incomingTotal/);
  assert.match(script, /outgoingTotal/);
  assert.match(script, /participant-linked activity/i);
});

test('live Asset Vault does not use market-wide volume as account balance', () => {
  assert.doesNotMatch(script, /verifiedVolume/);
  assert.doesNotMatch(script, /completedVolume/);
  assert.match(script, /Pending.*Not included in the recorded balance/s);
});
