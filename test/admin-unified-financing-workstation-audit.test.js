import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const workstation = await readFile(new URL('../public/admin/admin-unified-financing-workstation.js', import.meta.url), 'utf8');
const awaitingActions = await readFile(new URL('../public/admin/admin-financing-awaiting-actions.js', import.meta.url), 'utf8');
const dataClient = await readFile(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');
const authorization = await readFile(new URL('../middleware/operations-authorization.js', import.meta.url), 'utf8');

test('private admin loads the Unified Market Operations financing workstation', () => {
  assert.match(bootstrap, /admin-unified-financing-workstation\.js/);
  assert.match(bootstrap, /mountAdminUnifiedFinancingWorkstation/);
});

test('Unified Market Operations exposes the existing Financing renderer', () => {
  assert.match(workstation, /data-admin-tab="Financing"/);
  assert.match(workstation, /funding-operations-ui\.js/);
  assert.match(workstation, /renderParticipantFundingOperations/);
  assert.match(workstation, /api\/sane\/operations-queue/);
  assert.match(workstation, /api\/admin\/workspaces\?limit=100/);
  assert.match(workstation, /loadOperationsQueue/);
  assert.match(workstation, /sra:admin-financing-rendered/);
});

test('closing and funding actions remain inside the Financing workspace', () => {
  assert.match(awaitingActions, /tab === 'Financing'/);
  assert.match(awaitingActions, /data-financing-continuous-actions/);
  assert.match(awaitingActions, /Continue this financing workflow/);
  assert.match(awaitingActions, /sra:admin-financing-rendered/);
  assert.match(awaitingActions, /api\/financing-closing\/closings/);
});

test('successful financing actions refresh the active Financing workflow without another tab click', () => {
  assert.match(awaitingActions, /sra:admin-refresh/);
  assert.match(workstation, /event\.detail\?\.source === 'FINANCING_AWAITING_ACTION'/);
  assert.match(workstation, /refreshAdminFinancingWorkstation/);
  assert.match(workstation, /activeTab\(\) === 'Financing'/);
});

test('admin data client carries the administrator session through financing operations', () => {
  assert.match(dataClient, /ADMIN_OPERATION_PREFIXES/);
  assert.match(dataClient, /'\/api\/financing-closing'/);
  assert.match(dataClient, /'\/api\/funding-operations'/);
  assert.match(dataClient, /credentials: isAdminRequest \? 'include'/);
});

test('private administrator session can authorize governed funding writes', () => {
  assert.match(authorization, /startsWith\('\/api\/funding'\)/);
  assert.match(authorization, /startsWith\('\/api\/financing-closing'\)/);
  assert.match(authorization, /PRIVATE_ADMIN_SESSION/);
});
