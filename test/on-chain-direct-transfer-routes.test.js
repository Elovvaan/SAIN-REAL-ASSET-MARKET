import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/on-chain-projection-router.js', import.meta.url), 'utf8');

test('direct-mount routing remains normalized', () => {
  assert.match(router, /prefix = '\/api\/on-chain'/);
  assert.match(router, /router\.use\(normalizeDirectMount\)/);
});

test('on-chain API exposes the generic transfer surface', () => {
  assert.match(router, /router\.get\('\/status'/);
  assert.match(router, /router\.get\('\/transfers'/);
  assert.match(router, /router\.get\('\/transfers\/:transferId'/);
  assert.match(router, /router\.post\('\/transfers'/);
  assert.doesNotMatch(router, /router\.(?:get|post)\('\/(?:solana|dex)\//i);
});
