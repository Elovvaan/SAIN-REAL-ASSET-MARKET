import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');

test('private admin exposes the native platform asset approval control', () => {
  assert.match(html, /id="approve-platform-asset"/);
  assert.match(html, />Approve & Publish</);
  assert.match(html, /GET|\/api\/admin\/platform-asset/);
  assert.match(html, /\/api\/admin\/platform-asset\/bootstrap/);
  assert.match(html, /approval:'APPROVE'/);
});

test('private admin uses the authenticated intelligence agent endpoint', () => {
  assert.match(html, /\/api\/admin\/agent\/query/);
  assert.doesNotMatch(html, /\/api\/sane\/agent\/chat/);
});

test('approval control refreshes both asset and platform status', () => {
  assert.match(html, /Promise\.all\(\[loadPlatformAsset\(\),loadSummary\(\)\]\)/);
  assert.match(html, /READY_FOR_EXPORT/);
});
