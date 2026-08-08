import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = fs.readFileSync(new URL('../external/orca-executor/package.json', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../external/orca-executor/orca-worker.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../external/orca-executor/server.js', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../external/orca-executor/README.md', import.meta.url), 'utf8');

test('Orca executor is an isolated deployable service using the current high-level SDK line', () => {
  assert.match(pkg, /"@orca-so\/whirlpools": "8\.0\.1"/);
  assert.match(pkg, /"@solana\/kit": "2"/);
  assert.match(pkg, /"start": "node server\.js"/);
  assert.match(readme, /root directory to:\s*\n\s*`external\/orca-executor`/);
});

test('executor consumes only the SRA external DEX contract and requires authenticated idempotent execution', () => {
  assert.match(worker, /SRA_DEX_EXECUTOR_V1/);
  assert.match(worker, /CREATE_POOL_AND_SEED_LIQUIDITY/);
  assert.match(worker, /ORCA_WHIRLPOOLS/);
  assert.match(worker, /Idempotency-Key must equal dexExportId/);
  assert.match(worker, /pg_advisory_lock/);
  assert.match(worker, /sra_dex_executor_requests/);
  assert.match(server, /worker\.authenticate\(req\.get\('authorization'\)\)/);
  assert.match(server, /req\.get\('idempotency-key'\)/);
});

test('executor creates the pool and seeds full-range liquidity through Orca instead of implementing an AMM', () => {
  assert.match(worker, /createConcentratedLiquidityPool/);
  assert.match(worker, /openFullRangePosition/);
  assert.match(worker, /orderMints/);
  assert.match(worker, /FULL_RANGE/);
  assert.doesNotMatch(worker, /x\s*\*\s*y\s*=\s*k/);
  assert.doesNotMatch(worker, /constantProduct/i);
});

test('executor keeps market price separate from SRA recorded value', () => {
  assert.match(worker, /EXTERNAL_MARKET_PRICE_IS_OBSERVATIONAL_ONLY/);
  assert.match(worker, /recordedValueReference/);
  assert.match(worker, /observedMarketPriceSource:'POOL_INITIALIZATION_INPUT'/);
  assert.doesNotMatch(worker, /financialRecord.*=.*initialMarketPrice/i);
});

test('signing key remains executor-only configuration and is never returned by health', () => {
  assert.match(worker, /SOLANA_PAYER_SECRET_KEY/);
  assert.match(worker, /signerConfigured:Boolean/);
  assert.doesNotMatch(server, /SOLANA_PAYER_SECRET_KEY/);
  assert.doesNotMatch(server, /DEX_ORCA_EXECUTOR_TOKEN.*res\.json/);
  assert.match(readme, /Do not put `SOLANA_PAYER_SECRET_KEY` in the main SRA application/);
});
