import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('workspace shell preserves workspace-open for panel-backed navigation', () => {
  const source = fs.readFileSync(new URL('../public/workspace-shell-core.js', import.meta.url), 'utf8');
  assert.match(source, /PANEL_BACKED_VIEWS\s*=\s*new Set\(\['marketplace', 'positions'\]\)/);
  assert.match(source, /if \(PANEL_BACKED_VIEWS\.has\(view\)\) document\.body\.classList\.add\('workspace-open'\)/);
  assert.match(source, /else document\.body\.classList\.remove\('workspace-open'\)/);
});
