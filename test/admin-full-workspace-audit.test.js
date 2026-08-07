import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const router = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');

const workspaceIds = [
  'dashboard','operations','treasury','native-asset','marketplace','instruments','records',
  'coin-positions','transactions','settlement','agent','connections','users','system'
];

test('every administration workspace is declared in the shell', () => {
  for (const id of workspaceIds) assert.match(shell, new RegExp(`\\['${id}'`));
});

test('workspace API exposes the complete domain sources used by all tabs', () => {
  const requiredSources = [
    'instruments','marketplaceListings','marketplaceCommitments','marketplacePositions','marketplaceAllocations',
    'financialRecords','verifiedValueRecords','coinPositions','transactions','exportPackages','settlementInstructions',
    'ledgerAccounts','ledgerEntries','treasuryPaymentOrders','treasuryStatements','treasuryWallets','treasuryExceptions',
    'connectorDefinitions','enterpriseConnections','extractionRequests','extractionResults','outboundEvents','lifecycleEvents','users'
  ];
  for (const source of requiredSources) assert.match(router, new RegExp(`${source}:`));
  assert.match(router, /workspaceSources/);
  assert.match(router, /workspaces,/);
});

test('administration assets cannot remain stale after deployment', () => {
  assert.match(router, /Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate/);
  assert.match(router, /etag: false/);
  assert.match(router, /lastModified: false/);
  assert.match(router, /maxAge: 0/);
  assert.match(shell, /cache:'no-store'/);
  assert.match(shell, /_\=\$\{Date\.now\(\)\}/);
});

test('all workspace groups have dedicated record mappings', () => {
  for (const id of ['operations','treasury','native-asset','marketplace','instruments','records','coin-positions','transactions','settlement','connections','users','system','agent']) {
    assert.match(shell, new RegExp(`id==='${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
});

test('deleted placeholder-only text cannot return', () => {
  const deleted = [
    'Instrument registry, approvals, terms, and lifecycle history will appear here.',
    'Export packages and external settlement controls will appear here.',
    'Transaction search and state views will appear here.',
    'User roles, permissions, sessions, and administrator access will appear here.'
  ];
  for (const text of deleted) assert.doesNotMatch(shell, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('known unimplemented session persistence is reported truthfully', () => {
  assert.match(shell, /No persistent \$\{kind\} record source is implemented/);
  assert.match(shell, /NOT_IMPLEMENTED/);
});
