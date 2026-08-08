import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const workstation = fs.readFileSync(new URL('../public/admin/admin-users-permissions-workstation.js', import.meta.url), 'utf8');

test('Users and Permissions workstation is explicitly loaded and mounted', () => {
  assert.match(bootstrap, /admin-users-permissions-workstation\.js/);
  assert.match(bootstrap, /mountAdminUsersPermissionsWorkstation\?\.\(admin\.querySelector\('\[data-workspace="users"\]'\)\)/);
  assert.match(workstation, /window\.mountAdminUsersPermissionsWorkstation = mount/);
  assert.doesNotMatch(workstation, /MutationObserver/);
  assert.doesNotMatch(workstation, /DOMContentLoaded/);
});

test('all six access-control tabs have distinct semantic renderers', () => {
  for (const label of ['Access Control Overview','Administrators','Roles / Capacities','Permissions','Sessions','Access History']) {
    assert.match(workstation, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('workstation reflects the backend capacity model instead of inventing ACL records', () => {
  for (const role of ['UNIVERSAL','ASSET_PROVIDER','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN']) assert.match(workstation, new RegExp(role));
  assert.match(workstation, /CAPACITY-BASED/);
  assert.match(workstation, /does not maintain a separate free-form permission registry/);
});

test('sessions use the authenticated private admin session without exposing tokens', () => {
  assert.match(workstation, /\/api\/admin\/session/);
  assert.doesNotMatch(workstation, /tokenHash/);
  assert.doesNotMatch(workstation, /sra_admin_session/);
});

test('access history reports the real audit source instead of false empty history', () => {
  assert.match(workstation, /sra_audit_events/);
  assert.match(workstation, /SESSION_STARTED \/ SESSION_ENDED/);
  assert.match(workstation, /OPERATING_TIER_CHANGED/);
  assert.match(workstation, /does not currently expose an audit-history read endpoint/);
});
