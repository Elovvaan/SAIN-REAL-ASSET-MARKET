import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const adminIndex = read('../public/admin/index.html');
const bootstrap = read('../public/admin/admin-bootstrap.js');
const dataClient = read('../public/admin/admin-data-client.js');
const workstationControls = read('../public/admin/admin-workstation-controls.js');
const diagnosticsCore = read('../public/admin/admin-button-diagnostics-core.js');
const privateRouter = read('../routes/private-admin-router.js');
const treasuryRoutes = read('../routes/treasury-admin-routes.js');
const saneRouter = read('../routes/sane-router.js');

test('consolidated workstation controls own the primary administration actions', () => {
  for (const selector of [
    'data-market-ready','data-market-publish','data-market-policy','data-hybrid-preview','data-hybrid-approve',
    'data-coin-explain','data-deposit-preview','data-deposit-approve','data-journal-preview','data-journal-post','data-correct',
    'data-core-run','data-core-publish','data-approve-instruments'
  ]) assert.match(workstationControls, new RegExp(`\\[${selector}\\]`));

  assert.match(workstationControls, /addEventListener\(['"]click/);
  assert.match(workstationControls, /data-workspace=\\"marketplace\\"/);
  assert.match(workstationControls, /data-workspace=\\"operations\\"/);
  assert.match(workstationControls, /data-workspace=\\"treasury\\"/);
  assert.match(workstationControls, /data-workspace=\\"system\\"/);
  assert.match(workstationControls, /data-workspace=\\"instruments\\"/);
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

test('administration bootstrap loads one shell and one workstation-control owner', () => {
  assert.match(adminIndex, /admin-data-client\.js/);
  assert.match(adminIndex, /admin-bootstrap\.js/);
  assert.match(bootstrap, /admin-suite-shell\.js/);
  assert.match(bootstrap, /admin-workstation-controls\.js/);
  assert.match(bootstrap, /admin-button-diagnostics-core\.js/);

  for (const retired of [
    'listing-authorization-ui.js',
    'hybrid-liquidity-admin.js',
    'core-services-dashboard.js',
    'operations-queue-ui.js',
    'treasury-ledger-ui.js',
    'admin-instrument-approvals.js',
    'listing-readiness-policy-ui.js',
  ]) assert.doesNotMatch(bootstrap, new RegExp(retired.replaceAll('.', '\\.')));

  assert.doesNotMatch(bootstrap, /admin-workspace-data-bridge\.js/);
  assert.doesNotMatch(bootstrap, /admin-workspace-sync\.js/);
  assert.doesNotMatch(bootstrap, /admin-action-reconciliation\.js/);
  assert.doesNotMatch(bootstrap, /admin-settlement-destination\.js/);
});

test('consolidated workstation owner has no DOM observer or polling loop', () => {
  assert.doesNotMatch(workstationControls, /MutationObserver/);
  assert.doesNotMatch(workstationControls, /setInterval/);
  assert.match(workstationControls, /SRAAdminDataClient/);
  assert.match(workstationControls, /sra:admin-refresh/);
  assert.match(workstationControls, /sra:admin-mutated/);
});

test('administration still has one request runtime owner', () => {
  assert.match(dataClient, /window\.fetch = request/);
  assert.match(dataClient, /ADMIN_SESSION_TIMEOUT_MS/);
  assert.match(dataClient, /ADMIN_READ_CACHE_TTL_MS/);
  assert.match(dataClient, /activeWrites/);
  assert.match(dataClient, /inFlightReads/);
  assert.match(dataClient, /EXTERNAL_TRANSFER_INSTRUCTION/);
  assert.match(dataClient, /sra:admin-mutated/);
  assert.match(dataClient, /sra-admin-session-expired/);
  assert.match(dataClient, /HTTP \$\{response\.status\}/);

  assert.doesNotMatch(diagnosticsCore, /window\.fetch\s*=/);
  assert.doesNotMatch(diagnosticsCore, /nativeFetch/);
  assert.match(diagnosticsCore, /SRAAdminDataClient/);
  assert.match(diagnosticsCore, /eligible-instruments/);
  assert.match(diagnosticsCore, /replaceWith\(select\)/);
});
