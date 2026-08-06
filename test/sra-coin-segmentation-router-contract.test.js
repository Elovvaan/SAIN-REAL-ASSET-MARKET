import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/sane-router.js', import.meta.url), 'utf8');

test('SRA Coin segmentation is reachable through the mounted SANE router', () => {
  assert.match(router, /new SraCoinPositionSegmentationService\(domain\)/);
  assert.match(router, /router\.post\('\/coin-agents\/:coinPositionId\/segment\/preview'/);
  assert.match(router, /router\.post\('\/coin-agents\/:coinPositionId\/segment\/approve'/);
  assert.match(router, /coinSegmentation\.preview/);
  assert.match(router, /coinSegmentation\.approve/);
});
