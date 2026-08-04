import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/sra-agent-service.js', import.meta.url), 'utf8');

test('SAIN admin context contract remains explicit', () => {
  assert.match(source, /input\.context \|\| null/);
  assert.match(source, /liveAdministrativeContext/);
  assert.match(source, /CONNECTION_STATE_LOCK/);
  assert.match(source, /liveContextIncluded/);
});
