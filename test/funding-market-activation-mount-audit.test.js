import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const bootstrap = read('../public/public-bootstrap.js');
const marketDesk = read('../public/funding-market-activation-desk.js');

test('funding market activation mounts from the Financing lifecycle, not page observation', () => {
  assert.match(bootstrap, /'\/funding-market-activation-desk\.js'/);
  assert.match(marketDesk, /window\.mountFundingMarketActivationDesk = mount/);
  assert.match(marketDesk, /async function mount\(fundingRoot\)/);
  assert.match(marketDesk, /window\.addEventListener\('sra:funding-operations-rendered'/);
  assert.match(marketDesk, /event\.detail\?\.root\?\.querySelector\('\.funding-ops'\)/);
  assert.doesNotMatch(marketDesk, /MutationObserver/);
  assert.doesNotMatch(marketDesk, /DOMContentLoaded/);
  assert.doesNotMatch(marketDesk, /document\.querySelector\('#view-root \.funding-ops'\)/);
});

test('market publication, participation, allocation, settlement, and ownership capabilities remain intact', () => {
  assert.match(marketDesk, /\/api\/funding-marketplace\/instruments\//);
  assert.match(marketDesk, /\/api\/funding-marketplace-publication\/authorizations\//);
  assert.match(marketDesk, /\/api\/funding-marketplace-commitment\/windows\//);
  assert.match(marketDesk, /\/api\/funding-marketplace-allocation\/reviews\//);
  assert.match(marketDesk, /\/api\/funding-marketplace-settlement\/authorizations\//);
  assert.match(marketDesk, /Position settled and ownership recognized/);
});
