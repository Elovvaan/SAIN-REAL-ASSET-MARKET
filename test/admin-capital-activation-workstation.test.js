import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('admin exposes the governed capital activation workspace', () => {
  const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url),'utf8');
  const ui = fs.readFileSync(new URL('../public/admin/admin-agent-operations-workstation.js', import.meta.url),'utf8');
  const routes = fs.readFileSync(new URL('../routes/agent-workforce-admin-routes.js', import.meta.url),'utf8');
  assert.match(shell, /'Capital Activation'/);
  assert.match(ui, /\/api\/admin\/capital-activation/);
  assert.match(ui, /execution remains unauthorized/);
  assert.match(routes, /CapitalActivationAgentService/);
});
