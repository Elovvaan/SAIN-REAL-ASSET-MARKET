import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const adminIndex = read('../public/admin/index.html');
const bootstrap = read('../public/admin/admin-bootstrap.js');
const dataClient = read('../public/admin/admin-data-client.js');
const listingUi = read('../public/admin/listing-authorization-ui.js');
const instrumentApprovals = read('../public/admin/admin-instrument-approvals.js');
const treasuryUi = read('../public/admin/treasury-ledger-ui.js');
const operationsUi = read('../public/admin/operations-queue-ui.js');
const coreUi = read('../public/admin/core-services-dashboard.js');
const hybridUi = read('../public/admin/hybrid-liquidity-admin.js');
const diagnosticsCore = read('../public/admin/admin-button-diagnostics-core.js');
const privateRouter = read('../routes/private-admin-router.js');
const treasuryRoutes = read('../routes/treasury-admin-routes.js');
const saneRouter = read('../routes/sane-router.js');

function expectButtonHandler(source, id) {
  assert.match(source, new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]?\\)\\.addEventListener\\(['\"]click`), `${id} must have a click handler`);
}

test('every primary private-administration button has a wired click handler', () => {
  expectButtonHandler(adminIndex, 'signout');
  expectButtonHandler(adminIndex, 'send');
  expectButtonHandler(listingUi, 'approve-listing-batch');
  expectButtonHandler(listingUi, 'approve-publication-batch');
  expectButtonHandler(listingUi, 'authorize-current-market-cycle');
  expectButtonHandler(treasuryUi, 'funding-instrument-preview');
  expectButtonHandler(treasuryUi, 'funding-instrument-approve');
  expectButtonHandler(treasuryUi, 'treasury-preview');
  expectButtonHandler(treasuryUi, 'treasury-post');
  expectButtonHandler(treasuryUi, 'treasury-refresh');
  expectButtonHandler(treasuryUi, 'correct-recorded-value');
  assert.match(operationsUi, /addEventListener\(['"]click/);
  assert.match(coreUi, /addEventListener\(['"]click/);
  assert.match(hybridUi, /addEventListener\(['"]click/);
  assert.match(instrumentApprovals, /addEventListener\(['"]click/);
});

test('administration action endpoints exist in the mounted production routers', () => {
  const privateRoutes = `${privateRouter}\n${treasuryRoutes}`;
  for (const endpoint of [
    '/api/admin/platform-asset/bootstrap',
    '/api/admin/listing-readiness-batch/approve',
    '/api/admin/listing-publication-batch/approve',
    '/api/admin/treasury/journals/preview',
    '/api/admin/treasury/journals/approve',
    '/api/admin/treasury/funding-instrument-deposits/eligible-instruments',
    '/api/admin/treasury/funding-instrument-deposits/preview',
    '/api/admin/treasury/funding-instrument-deposits/approve',
    '/api/admin/recorded-value-representation/approve'
  ]) assert.match(privateRoutes, new RegExp(endpoint.replaceAll('/', '\\/')));

  for (const endpoint of ['/operations-queue', '/core-services/run', '/hybrid-liquidity/approve', '/coin-agents/']) {
    assert.match(saneRouter, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
});

test('administration has one bootstrap authority and one request normalization layer', () => {
  assert.match(adminIndex, /admin-data-client\.js/);
  assert.match(adminIndex, /admin-bootstrap\.js/);
  assert.doesNotMatch(adminIndex, /listing-authorization-ui\.js/);
  assert.doesNotMatch(adminIndex, /admin-settlement-destination\.js/);
  assert.doesNotMatch(adminIndex, /admin-button-diagnostics\.js/);

  for (const feature of [
    'listing-authorization-ui.js',
    'hybrid-liquidity-admin.js',
    'core-services-dashboard.js',
    'operations-queue-ui.js',
    'treasury-ledger-ui.js',
    'admin-button-diagnostics-core.js',
    'admin-suite-shell.js',
    'admin-instrument-approvals.js',
  ]) assert.match(bootstrap, new RegExp(feature.replaceAll('.', '\\.')));

  assert.doesNotMatch(bootstrap, /admin-workspace-data-bridge\.js/);
  assert.doesNotMatch(bootstrap, /admin-workspace-sync\.js/);
  assert.doesNotMatch(bootstrap, /admin-action-reconciliation\.js/);
  assert.doesNotMatch(bootstrap, /admin-settlement-destination\.js/);

  assert.doesNotMatch(listingUi, /loadAdminScript/);
  assert.doesNotMatch(listingUi, /setInterval/);
  assert.doesNotMatch(listingUi, /MutationObserver/);
  assert.doesNotMatch(instrumentApprovals, /MutationObserver/);

  assert.match(dataClient, /WORKSPACE_RECORD_LIMIT = 100/);
  assert.match(dataClient, /activeWrites/);
  assert.match(dataClient, /EXTERNAL_TRANSFER_INSTRUCTION/);
  assert.match(dataClient, /sra:admin-mutated/);
  assert.match(diagnosticsCore, /credentials: 'same-origin'/);
  assert.match(diagnosticsCore, /HTTP \$\{response\.status\}/);
  assert.match(diagnosticsCore, /eligible-instruments/);
});
