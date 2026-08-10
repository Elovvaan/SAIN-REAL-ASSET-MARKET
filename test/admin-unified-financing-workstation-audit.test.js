import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const workstation = await readFile(new URL('../public/admin/admin-unified-financing-workstation.js', import.meta.url), 'utf8');
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
});

test('private administrator session can authorize governed funding writes', () => {
  assert.match(authorization, /startsWith\('\/api\/funding'\)/);
  assert.match(authorization, /startsWith\('\/api\/financing-closing'\)/);
  assert.match(authorization, /PRIVATE_ADMIN_SESSION/);
});
