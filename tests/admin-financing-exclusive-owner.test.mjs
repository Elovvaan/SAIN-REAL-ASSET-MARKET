import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');

test('Financing is exclusively owned by its lazy workstation', () => {
  assert.match(shell, /FEATURE_ONLY_TABS = new Set\(\['operations::Financing'/);
  assert.match(shell, /if\(!FEATURE_ONLY_TABS\.has/);
  assert.match(shell, /if\(FEATURE_ONLY_TABS\.has/);
});
