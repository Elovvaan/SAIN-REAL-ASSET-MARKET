import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const router = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/admin/admin-suite-shell.css', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');

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
  assert.match(client, /cache: 'no-store'/);
  assert.match(shell, /_\=\$\{Date\.now\(\)\}/);
});

test('all workspace groups have dedicated record mappings', () => {
  for (const id of ['operations','treasury','native-asset','marketplace','instruments','records','coin-positions','transactions','settlement','connections','users','system','agent']) {
    assert.match(shell, new RegExp(`id==='${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
});

test('legacy action panels are routed once into visible workspace control containers', () => {
  assert.match(shell, /admin-workspace-controls/);
  assert.match(shell, /admin-legacy-source-root/);
  assert.match(shell, /routeKnownSections\(oldLayout \|\| admin\)/);
  assert.match(shell, /#asset-details/);
  assert.match(shell, /#listing-details/);
  assert.match(shell, /#chat-log/);
  assert.match(shell, /#protected-areas/);
});

test('only one administration shell is visible', () => {
  assert.match(css, /\.admin-source-layout,\.admin-source-metrics,\.admin-legacy-source-root\{display:none!important/);
  assert.doesNotMatch(css, /\.admin-suite \.layout\{display:contents\}/);
  assert.doesNotMatch(css, /\.admin-suite \.layout>div\{display:contents\}/);
  assert.match(css, /\.admin-workspace-controls>\.card/);
});

test('administration conceals legacy first paint and loads the suite shell before feature scripts', () => {
  const shellIndex = bootstrap.indexOf("['/admin/admin-suite-shell.js'");
  const listingIndex = bootstrap.indexOf("['/admin/listing-authorization-ui.js'");
  const treasuryIndex = bootstrap.indexOf("['/admin/treasury-ledger-ui.js'");
  assert.ok(shellIndex >= 0, 'suite shell must be declared');
  assert.ok(listingIndex > shellIndex, 'listing authorization must load after the suite shell');
  assert.ok(treasuryIndex > shellIndex, 'treasury feature must load after the suite shell');
  assert.match(bootstrap, /concealLegacyFirstPaint\(admin\)/);
  assert.match(bootstrap, /admin\.style\.visibility = 'hidden'/);
  assert.match(bootstrap, /await loadScript\(shellSource, shellMarker\)/);
  assert.match(bootstrap, /admin\.querySelector\('\.admin-suite'\)/);
  assert.match(bootstrap, /revealAdminSuite\(admin\)/);
  assert.match(bootstrap, /FEATURES\.slice\(1\)/);
});

test('workspace opened during the shared initial request is rendered when that request settles', () => {
  assert.match(shell, /const pending = loadWorkspaceData\(false\)/);
  assert.match(shell, /activeWorkspaceId\(\)/);
  assert.match(shell, /pending\.catch\(\(\)=>\{\}\)\.finally/);
});

test('successful admin mutations synchronize through the consolidated data client and bootstrap', () => {
  assert.match(client, /url\.pathname\.startsWith\('\/api\/admin\/'\)/);
  assert.match(client, /!\['GET', 'HEAD', 'OPTIONS'\]\.includes\(method\)/);
  assert.match(client, /sra:admin-mutated/);
  assert.match(bootstrap, /sra:admin-mutated/);
  assert.match(bootstrap, /data-refresh-workspace/);
  assert.match(bootstrap, /window\.loadSummary/);
  assert.doesNotMatch(bootstrap, /admin-workspace-sync\.js/);
});

test('active bootstrap has one feature ownership path', () => {
  assert.match(bootstrap, /const FEATURES = \[/);
  assert.match(bootstrap, /admin-suite-shell\.js/);
  assert.doesNotMatch(bootstrap, /admin-button-diagnostics\.js/);
  assert.doesNotMatch(bootstrap, /admin-action-reconciliation\.js/);
  assert.doesNotMatch(bootstrap, /admin-workspace-data-bridge\.js/);
  assert.doesNotMatch(bootstrap, /admin-settlement-destination\.js/);
});

test('marketplace status counts every source displayed by its tabs', () => {
  for (const source of ['marketplaceListings','marketplaceCommitmentWindows','marketplaceCommitments','marketplacePositions','marketplaceAllocations','marketplaceSettlementPreparations','marketplaceSettlementReviews','marketplaceSettlementAuthorizations','transactions','settlements','lifecycleEvents']) {
    assert.match(shell, new RegExp(`marketplaceDisplayedCount[\\s\\S]*${source}`));
  }
  assert.match(shell, /effectiveWorkspaceStatuses/);
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
