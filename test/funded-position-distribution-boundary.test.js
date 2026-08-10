import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [closing, distribution, preparation, publication, allocation, settlement, activation, preparationRouter] = await Promise.all([
  readFile(new URL('../services/financing-closing-service.js', import.meta.url), 'utf8'),
  readFile(new URL('../services/financed-position-distribution-service.js', import.meta.url), 'utf8'),
  readFile(new URL('../services/funding-marketplace-preparation-service.js', import.meta.url), 'utf8'),
  readFile(new URL('../services/funding-marketplace-publication-service.js', import.meta.url), 'utf8'),
  readFile(new URL('../services/funding-marketplace-allocation-service.js', import.meta.url), 'utf8'),
  readFile(new URL('../services/funding-marketplace-settlement-service.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/funding-market-activation-desk.js', import.meta.url), 'utf8'),
  readFile(new URL('../routes/funding-marketplace-preparation-router.js', import.meta.url), 'utf8'),
]);

test('funded settlement creates SRA-owned financed position before any participant workflow', () => {
  assert.match(closing, /FINANCED_POSITION/);
  assert.match(closing, /ownerId: 'SRA'/);
  assert.match(closing, /distributionStatus: 'RETAINED'/);
  assert.match(closing, /availableAmount: 0/);
  assert.match(closing, /FINANCED_POSITION_CREATED_FROM_FUNDED_FINANCING/);
});

test('position distribution is an explicit post-financing action', () => {
  assert.match(distribution, /POSITION_DISTRIBUTION_AUTHORIZATION/);
  assert.match(distribution, /makeAvailable/);
  assert.match(distribution, /PARTIAL_OFFER/);
  assert.match(distribution, /FULL_OFFER/);
  assert.match(distribution, /NON_TRANSFERABLE/);
  assert.match(activation, /Make Position Available/);
  assert.match(activation, /Participant demand is not required for financing/);
});

test('marketplace preparation rejects instrument-only origination', () => {
  assert.match(preparation, /funded position and distribution authorization are required/i);
  assert.match(preparationRouter, /FUNDED_POSITION_REQUIRED/);
  assert.match(preparationRouter, /positions\/:positionId\/preparations/);
  assert.doesNotMatch(activation, /funding-marketplace\/instruments\/.*\/preparations/);
});

test('marketplace lifecycle no longer rewrites the financing opportunity state', () => {
  assert.doesNotMatch(preparation, /FUNDING_OPPORTUNITY_MARKETPLACE_PREPARATION_STARTED/);
  assert.doesNotMatch(publication, /FUNDING_OPPORTUNITY_MARKETPLACE_PUBLISHED/);
  assert.doesNotMatch(allocation, /FUNDING_OPPORTUNITY_ALLOCATION_CREATED/);
  assert.doesNotMatch(settlement, /FUNDING_OPPORTUNITY_POSITION_SETTLED/);
});

test('participant settlement updates distribution on the underlying financed position', () => {
  assert.match(allocation, /financedPositionId/);
  assert.match(settlement, /FINANCED_POSITION_PARTICIPANT_TRANSFER_RECOGNIZED/);
  assert.match(settlement, /PARTIALLY_TRANSFERRED/);
  assert.match(settlement, /DISTRIBUTED/);
});