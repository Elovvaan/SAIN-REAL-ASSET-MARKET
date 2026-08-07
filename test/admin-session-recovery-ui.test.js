import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const client = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics-core.js', import.meta.url), 'utf8');

test('expired admin sessions surface an interactive recovery notice without reload', () => {
  assert.match(client, /window\.dispatchEvent\(new CustomEvent\('sra-admin-session-expired'\)\)/);
  assert.match(diagnostics, /Your Platform Administration session expired/);
  assert.match(diagnostics, /Sign in again/);
  assert.doesNotMatch(diagnostics, /window\.location\.reload/);
});
