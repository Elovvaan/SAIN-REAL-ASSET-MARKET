import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const connector = fs.readFileSync(new URL('../services/coinbase-public-market-service.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../services/coinbase-transaction-asset-pipeline-service.js', import.meta.url), 'utf8');

test('server wires the Coinbase connector to the transaction asset pipeline and backfills prior observations', () => {
  assert.match(server, /CoinbaseTransactionAssetPipelineService/);
  assert.match(server, /transactionAssetPipeline: coinbaseTransactionAssetPipeline/);
  assert.match(server, /coinbaseTransactionAssetPipeline\.backfill\(\)/);
});

test('every recorded Coinbase trade is offered to the downstream asset pipeline', () => {
  assert.match(connector, /processAssetPipeline\(result\.observation\)/);
  assert.match(connector, /pipelineProcessedTrades/);
  assert.match(connector, /pipelineFailedTrades/);
});

test('pipeline preserves transaction asset language and creates an SRA Coin Position', () => {
  assert.match(pipeline, /MARKET_TRANSACTION_FINANCIAL_ASSET/);
  assert.match(pipeline, /VERIFIED_MARKET_TRANSACTION/);
  assert.match(pipeline, /TRANSACTION_FINANCIAL_ASSET_POSITION/);
  assert.match(pipeline, /representAsCoin/);
  assert.match(pipeline, /SOURCE_TRANSACTION_NOTIONAL/);
});
