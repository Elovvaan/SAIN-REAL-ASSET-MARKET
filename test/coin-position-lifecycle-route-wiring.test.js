import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const routes = fs.readFileSync(new URL('../routes/treasury-admin-routes.js', import.meta.url), 'utf8');

test('Coin Position lifecycle aggregate is admin-authenticated and server-derived', () => {
  assert.match(routes, /new CoinPositionLifecycleReadService\(domain\)/);
  assert.match(routes, /router\.get\('\/api\/admin\/coin-position-lifecycle'/);
  assert.match(routes, /const session = await requireAdmin\(req, res\); if \(!session\) return;/);
  assert.match(routes, /coinPositionLifecycle\.read\(\)/);
});
