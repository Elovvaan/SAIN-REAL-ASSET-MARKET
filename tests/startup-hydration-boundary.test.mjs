import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const adminRouter = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');

test('core startup uses scoped hydration instead of loading every domain record', () => {
  assert.doesNotMatch(app, /await persistentDomain\.hydrate\(\);/);
  assert.match(app, /await persistentDomain\.hydrate\(\[\s*RECORD_TYPES\.ASSET_ACCOUNT/);
});

test('admin workspace hydrates only the record types requested by its active view', () => {
  assert.match(adminRouter, /const requestedRecordTypes = \[\.\.\.requestedKeys\]/);
  assert.match(adminRouter, /await domain\.hydrate\(requestedRecordTypes\)/);
});

test('optional performance runtime cannot block administration shell mounting', () => {
  const shellStart = bootstrap.indexOf('async function ensureShell()');
  const shellEnd = bootstrap.indexOf('async function boot()', shellStart);
  const ensureShell = bootstrap.slice(shellStart, shellEnd);
  assert.match(ensureShell, /await loadScript\(source, marker/);
  assert.match(ensureShell, /void ensurePerformanceRuntime\(\)\.catch/);
  assert.doesNotMatch(ensureShell, /await ensurePerformanceRuntime\(\)/);
  assert.doesNotMatch(bootstrap, /12000/);
});
