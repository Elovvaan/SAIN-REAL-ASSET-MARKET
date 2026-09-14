import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync(new URL('../services/funding-operations-service.js', import.meta.url), 'utf8');

test('Financing landing hydration is limited to visible summary records', () => {
  assert.match(service, /const INITIAL_RECORDS = Object\.freeze/);
  assert.match(service, /RECORDS\.OPPORTUNITY/);
  assert.match(service, /RECORDS\.RVU_RECOGNITION/);
  assert.match(service, /domain\.hydrate\(INITIAL_RECORDS\)/);
  assert.doesNotMatch(service, /domain\.hydrate\(Object\.values\(RECORDS\)\)/);
});
