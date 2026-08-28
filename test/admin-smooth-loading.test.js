import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const performanceRuntime = await readFile(new URL('../public/admin/admin-performance-runtime.js', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');

test('admin performance runtime keeps safe reads hot and deduplicates in-flight requests', () => {
  assert.match(performanceRuntime, /FRESH_TTL_MS = 30_000/);
  assert.match(performanceRuntime, /STALE_TTL_MS = 120_000/);
  assert.match(performanceRuntime, /inFlight\.has\(key\)/);
  assert.match(performanceRuntime, /void refreshInBackground\(key, input, init\)/);
  assert.match(performanceRuntime, /url\.pathname === '\/api\/sane\/operations-queue'/);
  assert.match(performanceRuntime, /url\.pathname === '\/api\/on-chain\/status'/);
});

test('admin performance cache excludes session probes and invalidates after changes', () => {
  assert.match(performanceRuntime, /url\.pathname === '\/api\/admin\/session'/);
  assert.match(performanceRuntime, /sra:admin-mutated/);
  assert.match(performanceRuntime, /sra:admin-refresh/);
  assert.match(performanceRuntime, /sra-admin-session-expired/);
});

test('admin bootstrap installs the performance runtime before the shell and parallelizes feature loading', () => {
  assert.match(bootstrap, /admin-performance-runtime\.js/);
  assert.match(bootstrap, /await ensurePerformanceRuntime\(\)/);
  assert.match(bootstrap, /Promise\.all\(featureList\.map/);
  assert.doesNotMatch(bootstrap, /for \(const \[source, marker\] of featureList\) await loadScript/);
});
