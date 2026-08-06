import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/participant-workspace-suite.js', import.meta.url), 'utf8');

test('participant suite owns participant views without internal workspace endpoints', () => {
  for (const view of ['home-projects', 'instruments', 'funding-operations', 'positions', 'custody', 'activity', 'assets', 'pools', 'participants']) {
    assert.match(source, new RegExp(`['\"]${view}['\"]`));
  }
  assert.doesNotMatch(source, /api\/home-projects|api\/funding-operations|institutional custody/i);
});

test('marketplace rendering remains delegated to the live-only market module', () => {
  assert.match(source, /if \(view === 'marketplace'\)/);
  assert.match(source, /nav-item\[data-view=\\?"marketplace\\?"\]/);
});

test('participant vault copy excludes restricted administrative records', () => {
  assert.match(source, /Restricted institutional records.*remain in Administration/);
  assert.doesNotMatch(source, /collateral schedules.*held/i);
});
