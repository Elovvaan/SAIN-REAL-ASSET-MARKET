import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/admin/admin-button-diagnostics.js', import.meta.url), 'utf8');

test('Administration reads are deduplicated and briefly cached', () => {
  assert.match(source, /const inFlightReads = new Map\(\)/);
  assert.match(source, /const readCache = new Map\(\)/);
  assert.match(source, /inFlightReads\.get\(key\)/);
  assert.match(source, /ADMIN_READ_CACHE_TTL_MS = 5_000/);
});

test('hidden Administration tabs reuse cached reads instead of adding load', () => {
  assert.match(source, /ADMIN_HIDDEN_CACHE_TTL_MS = 60_000/);
  assert.match(source, /document\.visibilityState === 'visible'/);
});

test('DOM button inspection is animation-frame throttled', () => {
  assert.match(source, /inspectionScheduled/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /new MutationObserver\(scheduleButtonInspection\)/);
});

test('successful writes invalidate read cache and announce state changes', () => {
  assert.match(source, /readCache\.clear\(\)/);
  assert.match(source, /sra-admin-data-changed/);
});
