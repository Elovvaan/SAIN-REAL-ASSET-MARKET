import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const suite = fs.readFileSync(new URL('../public/participant-workspace-suite.js', import.meta.url), 'utf8');

test('participant suite preserves existing navigation controls', () => {
  assert.doesNotMatch(suite, /nav\.innerHTML\s*=/);
  assert.match(suite, /nav\.append\(button\)/);
});

test('participant suite requires authentication and supports late loading', () => {
  assert.match(suite, /Boolean\(window\.accessState\?\.session\)/);
  assert.match(suite, /document\.readyState==='loading'/);
  assert.match(suite, /else initialize\(\)/);
  assert.match(suite, /signedIn\(\)\?mount\(\):unmount\(\)/);
});
