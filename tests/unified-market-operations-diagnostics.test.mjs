import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Unified Market Operations preserves route-scoped initialization', async () => {
  const [domainSource, closingRouter, actionSource, fundingService] = await Promise.all([
    read('services/persistent-domain-service.js'),
    read('routes/financing-closing-router.js'),
    read('public/admin/admin-financing-awaiting-actions.js'),
    read('services/funding-operations-service.js'),
  ]);

  assert.match(domainSource, /this\.hydratedTypes = new Set\(\)/);
  assert.match(domainSource, /this\.hydrationByType = new Map\(\)/);
  assert.match(closingRouter, /const ensurePositionDistribution =/);
  assert.match(closingRouter, /const ensureLoanFinancing =/);
  assert.match(closingRouter, /const ensureSettlementRoutes =/);
  assert.doesNotMatch(closingRouter, /const distributionReady = positionDistribution\.initialize\(\)/);
  assert.match(actionSource, /if \(loadInFlight\) return loadInFlight/);
  assert.match(fundingService, /const INITIAL_RECORDS = Object\.freeze\(\[\s*RECORDS\.OPPORTUNITY,\s*RECORDS\.RVU_RECOGNITION,/);
});
