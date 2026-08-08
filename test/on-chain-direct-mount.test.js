import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/on-chain-projection-router.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../public/admin/admin-external-dex-adapter.js', import.meta.url), 'utf8');

test('on-chain projection router normalizes the production direct mount prefix', () => {
  assert.match(router, /prefix = '\/api\/on-chain'/);
  assert.match(router, /router\.use\(normalizeDirectMount\)/);
  assert.match(router, /req\.url = req\.url\.slice\(prefix\.length\)/);
});

test('DEX administration reads routes owned by the on-chain router', () => {
  for (const route of [
    '/api/on-chain/dex/status',
    '/api/on-chain/dex/exports',
    '/api/on-chain/dex/exports/preview',
  ]) {
    assert.ok(admin.includes(route), `expected admin DEX adapter to reference ${route}`);
  }
  assert.match(router, /router\.get\('\/dex\/status'/);
  assert.match(router, /router\.get\('\/dex\/exports'/);
  assert.match(router, /router\.post\('\/dex\/exports\/preview'/);
  assert.match(router, /router\.post\('\/dex\/exports'/);
});
