import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('server binds bootstrap health endpoint before platform initialization', async () => {
  const source = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(source, /bootstrap\.listen\(port, '0\.0\.0\.0'/);
  assert.match(source, /bootstrap\.get\('\/api\/health'/);
  assert.match(source, /await createApp\(\)/);
  assert.ok(source.indexOf('bootstrap.listen') < source.indexOf('await createApp()'));
});
