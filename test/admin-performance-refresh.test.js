import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync(new URL('../public/admin/admin-data-client.js', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics-core.js', import.meta.url), 'utf8');

test('Administration reads are deduplicated and briefly cached', () => {
  assert.match(client, /const inFlightReads = new Map\(\)/);
  assert.match(client, /const readCache = new Map\(\)/);
  assert.match(client, /inFlightReads\.get\(readKey\)/);
  assert.match(client, /ADMIN_READ_CACHE_TTL_MS = 5_000/);
});

test('hidden Administration tabs reuse cached reads instead of adding load', () => {
  assert.match(client, /ADMIN_HIDDEN_CACHE_TTL_MS = 60_000/);
  assert.match(client, /document\.visibilityState === 'visible'/);
});

test('DOM button inspection is animation-frame throttled', () => {
  assert.match(diagnostics, /inspectionScheduled/);
  assert.match(diagnostics, /requestAnimationFrame/);
  assert.match(diagnostics, /new MutationObserver\(scheduleButtonInspection\)/);
});

test('successful writes invalidate read cache and announce state changes', () => {
  assert.match(client, /readCache\.clear\(\)/);
  assert.match(client, /sra-admin-data-changed/);
  assert.match(client, /sra:admin-mutated/);
});
