import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');

test('funding extension routers are mounted at their public API prefixes', () => {
  for (const prefix of [
    '/api/funding',
    '/api/funding-verification',
    '/api/funding-value',
    '/api/funding-model',
    '/api/funding-instrument',
    '/api/funding-instrument-review',
    '/api/funding-instrument-issuance',
    '/api/funding-marketplace',
    '/api/funding-marketplace-publication',
    '/api/funding-marketplace-commitment',
    '/api/funding-marketplace-allocation',
    '/api/funding-marketplace-settlement',
    '/api/funding-operations',
    '/api/financing-closing',
  ]) assert.match(source, new RegExp(`mountExtension\\('${prefix.replaceAll('/', '\\/')}'`));
});

test('extension mounting uses Express use semantics', () => {
  assert.match(source, /function mountExtension\(prefix, router\)/);
  assert.match(source, /mounted\.use\(prefix, router\)/);
});
