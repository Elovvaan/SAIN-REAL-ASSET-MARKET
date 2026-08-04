import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');

test('private administration has a separate login and session cookie', () => {
  assert.match(router, /\/api\/admin\/signin/);
  assert.match(router, /sra_admin_session/);
  assert.match(router, /SameSite=Strict/);
  assert.match(router, /activeCapacity === 'PLATFORM_ADMIN'/);
});

test('public login and public capacity switching cannot enter Platform Administration', () => {
  assert.match(server, /rejectPlatformAdminPublicSignin/);
  assert.match(server, /Platform Administration is available only through the private administration portal/);
  assert.match(server, /PLATFORM_ADMIN/);
});

test('admin summary requires private administrator authentication', () => {
  assert.match(router, /Private Platform Administration authentication is required/);
  assert.match(router, /router\.get\('\/api\/admin\/summary'/);
  assert.match(router, /stateChangesRequireApproval: true/);
});

test('private portal exposes admin agent and live platform records without public role switching', () => {
  assert.match(page, /SAIN Platform Administration/);
  assert.match(page, /Private operating portal/);
  assert.match(page, /SAIN Administrative Agent/);
  assert.match(page, /Proposed Changes \/ Approval Queue/);
  assert.doesNotMatch(page, /Switch to Platform Administration/);
});
