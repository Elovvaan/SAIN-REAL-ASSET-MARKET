import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');

test('expired admin sessions surface a visible recovery notice before reload', () => {
  assert.match(runtime, /Your Platform Administration session expired/);
  assert.match(runtime, /window\.dispatchEvent\(new CustomEvent\('sra-admin-session-expired'\)\)/);
  assert.match(runtime, /window\.setTimeout\(\(\) => window\.location\.reload\(\), 900\)/);
});
