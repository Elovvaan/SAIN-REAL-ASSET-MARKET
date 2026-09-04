import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const suite = await readFile(new URL('../public/participant-workspace-suite.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/participant-workspace-suite.css', import.meta.url), 'utf8');

test('signed-in marketplace hydrates a compact board from filtered live listings', () => {
  assert.match(suite, /data-participant-market-board/);
  assert.match(suite, /await getParticipantMirror\(\)/);
  assert.match(suite, /data\.listings/);
  assert.match(suite, /Only verified, unblocked LIVE listings appear/);
  assert.doesNotMatch(suite, /Bitcoin|Ethereum|Solana/);
});

test('compact market board preserves a bounded responsive footprint', () => {
  assert.match(css, /\.participant-market-list\{max-height:248px;overflow:auto\}/);
  assert.match(css, /\.participant-market-row\{display:grid/);
  assert.match(css, /@media\(max-width:620px\)\{\.participant-market-columns\{display:none\}/);
});
