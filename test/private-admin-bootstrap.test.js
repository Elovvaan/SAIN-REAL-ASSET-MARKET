import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');

test('private admin portal exposes one-time bootstrap status and creation endpoints', () => {
  assert.match(router, /\/api\/admin\/bootstrap-status/);
  assert.match(router, /\/api\/admin\/bootstrap/);
  assert.match(router, /SRA_ADMIN_SETUP_CODE/);
  assert.match(router, /Platform Administration has already been initialized/);
  assert.match(router, /PLATFORM_ADMINISTRATION_INITIALIZED/);
});

test('demo identities do not count as real Platform Administrators', () => {
  assert.match(router, /endsWith\('@sra\.demo'\)/);
  assert.match(router, /isRealAdministrator/);
  assert.match(router, /This identity is not authorized for Platform Administration/);
});

test('admin page separates one-time initialization from normal sign-in', () => {
  assert.match(page, /Create Platform Administrator/);
  assert.match(page, /One-time setup code/);
  assert.match(page, /Create password/);
  assert.match(page, /Confirm password/);
  assert.match(page, /\/api\/admin\/bootstrap/);
  assert.match(page, /\/api\/admin\/signin/);
  assert.match(page, /SRA_ADMIN_SETUP_CODE/);
});
