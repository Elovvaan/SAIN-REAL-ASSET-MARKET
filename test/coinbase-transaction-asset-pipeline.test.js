import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservationLayerService } from '../services/observation-layer-service.js';
import { FinancialRecordService } from '../services/financial-record-service.js';
import { CoinbaseTransactionAssetPipelineService } from '../services/coinbase-transaction-asset-pipeline-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  list(type) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${type}:`))
      .map(([, value]) => structuredClone(value));
  }
  get(type, id) {
    const value = this.records.get(this.key(type, id));
    return value ? structuredClone(value) : null;
  }
  async put(type, id, value) {
    this.records.set(this.key(type, id), structuredClone(value));
    return structuredClone(value);
  }
  async lifecycle(event) { this.events.push(structuredClone(event)); return event; }
}

async function seedTrade(observations, tradeId = '9001', notional = 600) {
  return observations.observe({
    sourceMarket: 'COINBASE',
    sourceRecordId: `BTC-USD:${tradeId}`,
    sourceRecordType: 'MARKET_TRADE',
    sourceTimestamp: '2026-08-04T22:00:00.000Z',
    connectorId: 'COINBASE_PUBLIC_MARKET_TRADES',
    category: 'CRYPTO_MARKET_TRANSACTION',
    rawValues: {
      tradeId,
      productId: 'BTC-USD',
      price: 60000,
      size: notional / 60000,
      notional,
      side: 'BUY'
    },
    rawPayload: { trade_id: tradeId, product_id: 'BTC-USD', price: '60000', size: String(notional / 60000), side: 'BUY' },
    sourceReference: `coinbase:advanced-trade:market_trades:BTC-USD:${tradeId}`
  }, 'COINBASE_PUBLIC_MARKET_TRADES');
}

function services() {
  const domain = new MemoryDomain();
  const observations = new ObservationLayerService(domain);
  const financialRecords = new FinancialRecordService(domain);
  const pipeline = new CoinbaseTransactionAssetPipelineService({
    observationLayerService: observations,
    financialRecordService: financialRecords,
    persistentDomain: domain,
    environment: { COINBASE_TRANSACTION_ASSET_PIPELINE_ENABLED: 'true' },
    logger: { error() {} }
  });
  return { domain, observations, financialRecords, pipeline };
}

test('Coinbase trade becomes a Recognition, Financial Record, and SRA Coin Position', async () => {
  const { domain, observations, pipeline } = services();
  const { observation } = await seedTrade(observations);
  const result = await pipeline.processObservation(observation);

  assert.equal(result.processed, true);
  assert.equal(result.recognition.decision, 'RECOGNIZED');
  assert.equal(result.recognition.classification.type, 'VERIFIED_MARKET_TRANSACTION');
  assert.equal(result.recognition.measurement.method, 'SOURCE_TRANSACTION_NOTIONAL');
  assert.equal(result.recognition.measurement.value, 600);

  assert.equal(result.financialRecord.recordType, 'MARKET_TRANSACTION_FINANCIAL_ASSET');
  assert.equal(result.financialRecord.recognizedPosition.amount, 600);
  assert.equal(result.financialRecord.observationId, observation.observationId);

  assert.equal(result.coinPosition.symbol, 'SRA');
  assert.equal(result.coinPosition.quantity, 600);
  assert.equal(result.coinPosition.representationType, 'TRANSACTION_FINANCIAL_ASSET_POSITION');
  assert.equal(result.coinPosition.sourceLineage.observationId, observation.observationId);
  assert.equal(result.coinPosition.state, 'REPRESENTED');

  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 1);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 1);
});

test('reprocessing the same observation returns the existing asset chain', async () => {
  const { domain, observations, pipeline } = services();
  const { observation } = await seedTrade(observations);
  const first = await pipeline.processObservation(observation);
  const second = await pipeline.processObservation(observation.observationId);

  assert.equal(second.processed, true);
  assert.equal(second.recognition.recognitionId, first.recognition.recognitionId);
  assert.equal(second.financialRecord.financialRecordId, first.financialRecord.financialRecordId);
  assert.equal(second.coinPosition.coinPositionId, first.coinPosition.coinPositionId);
  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 1);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 1);
});

test('backfill processes previously recorded Coinbase observations', async () => {
  const { domain, observations, pipeline } = services();
  await seedTrade(observations, '9001', 600);
  await seedTrade(observations, '9002', 125);

  const status = await pipeline.backfill();

  assert.equal(status.backfillState, 'COMPLETED');
  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 2);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 2);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 2);
  assert.equal(domain.list(RECORD_TYPES.COIN_ACCOUNT).length, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT).length, 1);
});

test('public trade recognition does not infer the identity of an underlying Coinbase customer', async () => {
  const { observations, pipeline } = services();
  const { observation } = await seedTrade(observations);
  const result = await pipeline.processObservation(observation);

  assert.equal(result.recognition.identity.subjectType, 'MARKET_PRODUCT');
  assert.equal(result.recognition.identity.subjectId, 'COINBASE:BTC-USD');
  assert.ok(result.recognition.limitations.includes('PUBLIC_MARKET_TRADE_DOES_NOT_INFER_UNDERLYING_CUSTOMER_IDENTITY'));
  assert.ok(result.financialRecord.restrictions.some((item) => item.type === 'NO_UNDERLYING_ACCOUNT_OWNERSHIP_INFERRED'));
});
