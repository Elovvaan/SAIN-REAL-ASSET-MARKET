import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');

test('admin shell does not use decorative workspace placeholders', () => {
  assert.equal(shell.includes('will appear here'), false);
  assert.match(shell, /\/api\/admin\/workspaces\?limit=500/);
  assert.match(shell, /The platform did not respond within 10 seconds/);
  assert.match(shell, /No .* records are currently stored/);
});

test('admin workspace API exposes the operating record chain', () => {
  for (const required of [
    'SRA_INSTRUMENT',
    'MARKETPLACE_LISTING',
    'FINANCIAL_RECORD',
    'COIN_POSITION',
    'SRA_TRANSACTION',
    'EXPORT_PACKAGE',
    'SETTLEMENT_RAIL_INSTRUCTION',
    'SETTLEMENT_RAIL_ADAPTER',
    'SRA_SETTLEMENT',
    'LIFECYCLE_EVENT'
  ]) assert.match(router, new RegExp(`RECORD_TYPES\\.${required}`));
  assert.match(router, /router\.get\('\/api\/admin\/workspaces'/);
});

test('export and settlement tabs render stored package and rail records', () => {
  assert.match(shell, /if\(tab==='Export Packages'\)return r\.exportPackages/);
  assert.match(shell, /if\(tab==='Settlement Instructions'\)return r\.settlementInstructions/);
  assert.match(shell, /if\(tab==='Destination Verification'\)/);
  assert.match(shell, /if\(tab==='Settlement Logs'\)/);
});
