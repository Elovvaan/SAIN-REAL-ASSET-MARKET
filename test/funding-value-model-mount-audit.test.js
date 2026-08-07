import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const bootstrap = read('../public/public-bootstrap.js');
const fundingOperations = read('../public/funding-operations-ui.js');
const valueModelDesk = read('../public/funding-value-model-desk.js');

test('Verified Value and funding model desk mounts from the Financing lifecycle', () => {
  assert.match(bootstrap, /'\/funding-value-model-desk\.js'/);
  assert.match(fundingOperations, /sra:funding-operations-rendered/);
  assert.match(valueModelDesk, /window\.mountFundingValueModelDesk = mount/);
  assert.match(valueModelDesk, /window\.addEventListener\('sra:funding-operations-rendered'/);
  assert.match(valueModelDesk, /event\.detail\?\.root\?\.querySelector\?\.\('\.funding-ops'\)/);
  assert.match(valueModelDesk, /async function mount\(fundingRoot\)/);
  assert.doesNotMatch(valueModelDesk, /MutationObserver/);
  assert.doesNotMatch(valueModelDesk, /DOMContentLoaded/);
  assert.doesNotMatch(valueModelDesk, /document\.querySelector\('#view-root \.funding-ops'\)/);
});

test('Verified Value and funding model capability preserves the Phase 3-4 workflow', () => {
  assert.match(valueModelDesk, /\/api\/funding-value\/opportunities\/\$\{encodeURIComponent\(opportunityId\)\}\/preparations/);
  assert.match(valueModelDesk, /\/api\/funding-value\/preparations\/\$\{encodeURIComponent\(preparation\.preparationId\)\}\/complete/);
  assert.match(valueModelDesk, /\/api\/funding-model\/opportunities\/\$\{encodeURIComponent\(opportunityId\)\}\/selections/);
  assert.match(valueModelDesk, /\/api\/funding-model\/selections\/\$\{encodeURIComponent\(selected\.selectionId\)\}\/instrument-request/);
  assert.match(valueModelDesk, /Verified Value and funding model/);
  assert.match(valueModelDesk, /FUNDING MODEL ASSESSMENT/);
});
