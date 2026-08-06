import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync(new URL('../services/platform-funding-instrument-deposit-service.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../routes/treasury-admin-routes.js', import.meta.url), 'utf8');

test('Treasury registers one canonical $18M self-financing instrument', () => {
  assert.match(service, /INS-SRA-PLATFORM-FUNDING-18000000/);
  assert.match(service, /18_000_000/);
  assert.match(routes, /instrumentPurpose: 'PLATFORM_SELF_FINANCING'/);
  assert.match(routes, /SRA Platform Commercial Funding Instrument/);
  assert.match(routes, /AVAILABLE_FOR_TREASURY_DEPOSIT/);
});

test('marketplace transaction instruments cannot establish platform financing capacity', () => {
  assert.match(service, /Marketplace transaction instruments cannot establish the platform Treasury position/);
  assert.match(routes, /instrument\.instrumentId === CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID/);
  assert.match(routes, /instrument\.instrumentPurpose === 'PLATFORM_SELF_FINANCING'/);
});

test('canonical approval reconciles legacy deposits and the existing manual $18M journal', () => {
  assert.match(service, /SUPERSEDED_NON_PLATFORM_INSTRUMENT/);
  assert.match(service, /existingCashFundingJournalId/);
  assert.match(service, /reclassifiesExistingCashJournal/);
  assert.match(service, /CANONICAL_PLATFORM_FUNDING_INSTRUMENT_RECONCILIATION/);
  assert.match(service, /SRA_REPRESENTED_ACCOUNT/);
  assert.match(service, /ADD_A_SECOND_18M_POSITION/);
});

test('Treasury summary exposes canonical financing capacity and SRA representation', () => {
  assert.match(routes, /commercialInstrumentUsd: fundingSummary\.depositedInstrumentValueUsd/);
  assert.match(routes, /availableFinancingCapacityUsd: fundingSummary\.availableFinancingCapacityUsd/);
  assert.match(routes, /sraRepresentedAtParUsd: fundingSummary\.representedSraQuantity/);
  assert.match(service, /representedSraQuantity: canonical/);
});
