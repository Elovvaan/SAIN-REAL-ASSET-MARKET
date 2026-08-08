import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ExternalDexExecutorService } from '../services/external-dex-executor-service.js';

const route = fs.readFileSync(new URL('../routes/on-chain-projection-router.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../public/admin/admin-external-dex-executor.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');

const dexExport = {
  dexExportId: 'DEX-EXP-1', state: 'READY_FOR_EXTERNAL_DEX', venue: 'ORCA_WHIRLPOOLS', network: 'SOLANA',
  sourceExportPackageId: 'EXP-1', projectionId: 'OCP-1', instrumentId: 'INS-1', pair: 'ASSET/USDC',
  baseMintAddress: 'BASE_MINT', quoteMintAddress: 'USDC_MINT', quantity: 10, recordedValueReference: 'FR-1'
};

test('executor is disabled unless live endpoint and credential are configured', () => {
  assert.equal(new ExternalDexExecutorService({ environment: {} }).status().ready, false);
  assert.equal(new ExternalDexExecutorService({ environment: { DEX_ORCA_EXECUTION_MODE:'LIVE', DEX_ORCA_EXECUTOR_ENDPOINT:'https://executor.test', DEX_ORCA_EXECUTOR_TOKEN:'secret' } }).status().ready, true);
});

test('executor contract separates external market inputs from recorded value', () => {
  const service = new ExternalDexExecutorService({ environment: {} });
  const request = service.executionRequest(dexExport, { quoteLiquidityQuantity: 25, initialMarketPrice: 2.5, tickSpacing: 64 });
  assert.equal(request.action, 'CREATE_POOL_AND_SEED_LIQUIDITY');
  assert.equal(request.baseLiquidityQuantity, 10);
  assert.equal(request.quoteLiquidityQuantity, 25);
  assert.equal(request.initialMarketPrice, 2.5);
  assert.equal(request.recordedValueReference, 'FR-1');
  assert.equal(request.marketPricePolicy, 'EXTERNAL_MARKET_PRICE_IS_OBSERVATIONAL_ONLY');
});

test('live executor posts idempotent Orca handoff and returns external references', async () => {
  let request;
  const service = new ExternalDexExecutorService({
    environment: { DEX_ORCA_EXECUTION_MODE:'LIVE', DEX_ORCA_EXECUTOR_ENDPOINT:'https://executor.test', DEX_ORCA_EXECUTOR_TOKEN:'secret' },
    fetchImpl: async (_url, options) => {
      request = options;
      return { ok:true, json:async () => ({ connectorReference:'ORCA-REQ-1', transactionSignature:'SIG-1', poolAddress:'POOL-1', observedMarketPrice:2.6 }) };
    }
  });
  const result = await service.execute(dexExport, { quoteLiquidityQuantity:25, initialMarketPrice:2.5 });
  assert.equal(request.headers['Idempotency-Key'], 'DEX-EXP-1');
  assert.equal(request.headers['X-SRA-DEX-Contract'], 'SRA_DEX_EXECUTOR_V1');
  assert.equal(result.connectorReference, 'ORCA-REQ-1');
  assert.equal(result.poolAddress, 'POOL-1');
});

test('router and Administration expose the live executor without moving execution into SRA', () => {
  assert.match(route, /ExternalDexExecutorService/);
  assert.match(route, /\/dex\/executor\/status/);
  assert.match(route, /\/dex\/exports\/:dexExportId\/execute/);
  assert.match(admin, /Execute on Orca/);
  assert.match(admin, /Initial market price/);
  assert.match(admin, /Quote liquidity quantity/);
  assert.match(bootstrap, /admin-external-dex-executor\.js/);
  assert.match(bootstrap, /mountAdminExternalDexExecutor/);
});
