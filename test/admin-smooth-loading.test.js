import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const performanceRuntime = await readFile(new URL('../public/admin/admin-performance-runtime.js', import.meta.url), 'utf8');
const dataClient = await readFile(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');

test('admin performance runtime keeps safe reads hot and deduplicates in-flight requests', () => {
  assert.match(performanceRuntime, /FRESH_TTL_MS = 30_000/);
  assert.match(performanceRuntime, /STALE_TTL_MS = 120_000/);
  assert.match(performanceRuntime, /existing\?\.generation === requestGeneration/);
  assert.match(performanceRuntime, /void fetchFresh\(key, input, init, requestGeneration\)/);
  assert.match(performanceRuntime, /url\.pathname === '\/api\/sane\/operations-queue'/);
  assert.match(performanceRuntime, /url\.pathname === '\/api\/on-chain\/status'/);
});

test('admin performance cache excludes session probes and invalidates after changes', () => {
  assert.match(performanceRuntime, /url\.pathname === '\/api\/admin\/session'/);
  assert.match(performanceRuntime, /sra:admin-mutated/);
  assert.match(performanceRuntime, /sra:admin-refresh/);
  assert.match(performanceRuntime, /sra-admin-session-expired/);
});

test('cache-buster forces every cacheable endpoint to perform a fresh read', () => {
  assert.match(performanceRuntime, /url\.searchParams\.has\('_'\)/);
  assert.match(performanceRuntime, /if \(explicitlyFresh\(input, init\)\)/);
  assert.match(performanceRuntime, /invalidateKey\(key\)/);
  assert.match(performanceRuntime, /cache: 'reload'/);
  assert.doesNotMatch(performanceRuntime, /forceNextWorkspaceRead/);
});

test('delegated admin client bypasses its lower cache for forced reads', () => {
  assert.match(dataClient, /forcedRead = original\.searchParams\.has\('_'\) \|\| init\.cache === 'reload'/);
  assert.match(dataClient, /cacheableRead = .*&& !forcedRead/);
  assert.match(dataClient, /if \(forcedRead && method === 'GET'\) invalidateReads\(\)/);
  assert.doesNotMatch(dataClient, /url\.searchParams\.delete\('_'\)/);
});

test('invalidated in-flight reads cannot repopulate either cache layer', () => {
  assert.match(performanceRuntime, /generation \+= 1/);
  assert.match(performanceRuntime, /response\.ok && generation === requestGeneration/);
  assert.match(performanceRuntime, /inFlight\.set\(key, \{ generation: requestGeneration, promise: pending \}\)/);
  assert.match(dataClient, /readGeneration \+= 1/);
  assert.match(dataClient, /value\.ok && readGeneration === requestGeneration/);
  assert.match(dataClient, /inFlightReads\.set\(readKey, \{ generation: requestGeneration, promise: pending \}\)/);
});

test('admin bootstrap installs the performance runtime before the shell and parallelizes feature loading', () => {
  assert.match(bootstrap, /admin-performance-runtime\.js/);
  assert.match(bootstrap, /await ensurePerformanceRuntime\(\)/);
  assert.match(bootstrap, /Promise\.all\(featureList\.map/);
  assert.doesNotMatch(bootstrap, /for \(const \[source, marker\] of featureList\) await loadScript/);
});
