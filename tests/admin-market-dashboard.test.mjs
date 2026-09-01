import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const router = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../public/admin/admin-market-dashboard.js', import.meta.url), 'utf8');

test('admin dashboard owns the market reading and workflow feature', () => {
  assert.match(bootstrap, /dashboard:\s*\[\s*\['\/admin\/admin-market-dashboard\.js'/);
  assert.match(bootstrap, /workspaceId === 'dashboard'/);
  assert.doesNotMatch(bootstrap, /operations:\s*\[[\s\S]{0,180}admin-market-dashboard/);
  assert.match(dashboard, /MARKET READING & WORKFLOW/);
  assert.match(dashboard, /Productive baskets/);
  assert.match(dashboard, /Administrative workflow/);
});

test('initial dashboard avoids the full workspace records request', () => {
  assert.match(shell, /id!==['"]dashboard['"] && !state\.workspaceData/);
  assert.doesNotMatch(shell, /admin\/workspaces\?limit=1000/);
  assert.doesNotMatch(shell, /admin\/workspaces[^\n]+Date\.now/);
  assert.match(dashboard, /fetch\('\/api\/admin\/dashboard'/);
});

test('compact dashboard endpoint is admin protected and includes both markets', () => {
  assert.match(router, /router\.get\('\/api\/admin\/dashboard'/);
  assert.match(router, /const session = await requireAdmin\(req, res\)/);
  assert.match(router, /RECORD_TYPES\.EVENT_MARKET/);
  assert.match(router, /RECORD_TYPES\.PRODUCTIVE_BASKET/);
  assert.match(router, /workflow:\s*workflow\.slice/);
});
