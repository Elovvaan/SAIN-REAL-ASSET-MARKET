import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync(new URL('../services/platform-chain-operations-agent-service.js', import.meta.url), 'utf8');

test('reviewed SRA chain target remains executable when only platform supply increases', () => {
  assert.match(service, /function reviewedSyncJob\(jobId\)/);
  assert.match(service, /current\.platformSupply >= reviewed\.targetSupply/);
  assert.match(service, /current\.issuedOnChainSupply === reviewed\.approvedIssuedOnChainSupply/);
  assert.match(service, /currentMint === reviewed\.mintAddress/);
  assert.match(service, /targetSupply: reviewed\.targetSupply/);
  assert.match(service, /reviewedSupplyAdvancedTo: current\.platformSupply/);
});

test('reviewed approval still mints only its exact target', () => {
  assert.match(service, /approvedTargetSupply !== job\.targetSupply/);
  assert.match(service, /targetSupply: job\.targetSupply/);
  assert.match(service, /expectedIssuedOnChainSupply: job\.approvedIssuedOnChainSupply/);
  assert.match(service, /snapshotVersion: job\.snapshotVersion/);
});

test('later SRA remains pending instead of expanding an old approval', () => {
  assert.match(service, /additional authoritative SRA supply/);
  assert.match(service, /newly produced SRA remains pending for the next job/);
  assert.match(service, /platformSupplyAtExecution: current\.platformSupply/);
});
