import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const bootstrap = read('../public/public-bootstrap.js');
const instrumentDesk = read('../public/funding-instrument-desk.js');


test('funding instrument desk mounts from the Financing lifecycle, not page observation', () => {
  assert.match(bootstrap, /'\/funding-instrument-desk\.js'/);
  assert.match(instrumentDesk, /window\.mountFundingInstrumentDesk = mount/);
  assert.match(instrumentDesk, /async function mount\(fundingRoot\)/);
  assert.match(instrumentDesk, /window\.addEventListener\('sra:funding-operations-rendered'/);
  assert.match(instrumentDesk, /event\.detail\?\.root\?\.querySelector\('\.funding-ops'\)/);
  assert.doesNotMatch(instrumentDesk, /MutationObserver/);
  assert.doesNotMatch(instrumentDesk, /DOMContentLoaded/);
  assert.doesNotMatch(instrumentDesk, /document\.querySelector\('#view-root \.funding-ops'\)/);
});


test('instrument selection, review, authorization, and issuance capabilities remain intact', () => {
  assert.match(instrumentDesk, /\/api\/funding-instrument\/requests\//);
  assert.match(instrumentDesk, /\/api\/funding-instrument\/selections\//);
  assert.match(instrumentDesk, /\/api\/funding-instrument-review\/instruments\//);
  assert.match(instrumentDesk, /\/api\/funding-instrument-review\/reviews\//);
  assert.match(instrumentDesk, /\/api\/funding-instrument-issuance\/requests\//);
  assert.match(instrumentDesk, /\/api\/funding-instrument-issuance\/reviews\//);
  assert.match(instrumentDesk, /\/api\/funding-instrument-issuance\/authorizations\//);
  assert.match(instrumentDesk, /Instrument issued and authoritative issuance transaction recorded/);
});
