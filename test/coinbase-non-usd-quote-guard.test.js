import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservationLayerService } from '../services/observation-layer-service.js';
import { FinancialRecordService } from '../services/financial-record-service.js';
import { CoinbaseTransactionAssetPipelineService } from '../services/coinbase-transaction-asset-pipeline-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  async put(type, id, value) { this.records.set(this.key(type, id), structuredClone(value)); return structuredClone(value); }
  async lifecycle() {}
}

function build() {
  const domain = new MemoryDomain();
  const observations = new ObservationLayerService(domain);
  const financialRecords = new FinancialRecordService(domain);
  const pipeline = new CoinbaseTransactionAssetPipelineService({ observationLayerService: observations, financialRecordService: financialRecords, persistentDomain: domain, environment: { COINBASE_TRANSACTION_ASSET_PIPELINE_ENABLED: 'true' }, logger: { error() {} } });
  return { domain, observations, pipeline };
}

async function observe(observations, productId, price, size) {
  return observations.observe({
    sourceMarket: 'COINBASE', sourceRecordId: `${productId}:1`, sourceRecordType: 'MARKET_TRADE', sourceTimestamp: '2026-08-09T15:00:00.000Z', connectorId: 'COINBASE_PUBLIC_MARKET_TRADES', category: 'CRYPTO_MARKET_TRANSACTION',
    rawValues: { tradeId: '1', productId, price, size, notional: price * size, side: 'BUY' },
    rawPayload: { trade_id: '1', product_id: productId, price: String(price), size: String(size), side: 'BUY' },
    sourceReference: `coinbase:advanced-trade:market_trades:${productId}:1`
  }, 'COINBASE_PUBLIC_MARKET_TRADES');
}

test('USD quoted trade preserves native quantity and represents recognized USD at par', async () => {
  const { observations, pipeline } = build();
  const { observation } = await observe(observations, 'BTC-USD', 60000, 1);
  const result = await pipeline.processObservation(observation);
  assert.equal(result.coinPosition.sourcePosition.amount, 1);
  assert.equal(result.coinPosition.sourcePosition.unit, 'BTC');
  assert.equal(result.coinPosition.recordedValue.amount, 60000);
  assert.equal(result.coinPosition.recordedValue.currency, 'USD');
  assert.equal(result.coinPosition.quantity, 60000);
});

test('non-USD quoted trade cannot enter SRA par representation without FX conversion', async () => {
  const { domain, observations, pipeline } = build();
  const { observation } = await observe(observations, 'BTC-EUR', 55000, 1);
  await assert.rejects(() => pipeline.processObservation(observation), (error) => error?.code === 'COINBASE_NON_USD_QUOTE_REQUIRES_FX_CONVERSION');
  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 0);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 0);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 0);
});