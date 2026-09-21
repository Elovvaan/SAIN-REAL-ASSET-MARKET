import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservationLayerService } from '../services/observation-layer-service.js';
import { FinancialRecordService } from '../services/financial-record-service.js';
import { CoinbaseTransactionAssetPipelineService } from '../services/coinbase-transaction-asset-pipeline-service.js';
import { InstrumentEngineService } from '../services/instrument-engine-service.js';
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

async function seedTrade(observations, tradeId = '9001', notional = 600, price = 60000, productId = 'BTC-USD') {
  const size = notional / price;
  return observations.observe({
    sourceMarket: 'COINBASE',
    sourceRecordId: `${productId}:${tradeId}`,
    sourceRecordType: 'MARKET_TRADE',
    sourceTimestamp: '2026-08-04T22:00:00.000Z',
    connectorId: 'COINBASE_PUBLIC_MARKET_TRADES',
    category: 'CRYPTO_MARKET_TRANSACTION',
    rawValues: {
      tradeId,
      productId,
      price,
      size,
      notional,
      side: 'BUY'
    },
    rawPayload: { trade_id: tradeId, product_id: productId, price: String(price), size: String(size), side: 'BUY' },
    sourceReference: `coinbase:advanced-trade:market_trades:${productId}:${tradeId}`
  }, 'COINBASE_PUBLIC_MARKET_TRADES');
}

function services(environment = {}) {
  const domain = new MemoryDomain();
  const observations = new ObservationLayerService(domain);
  const financialRecords = new FinancialRecordService(domain);
  const pipeline = new CoinbaseTransactionAssetPipelineService({
    observationLayerService: observations,
    financialRecordService: financialRecords,
    persistentDomain: domain,
    environment: {
      COINBASE_TRANSACTION_ASSET_PIPELINE_ENABLED: 'true',
      ...environment
    },
    logger: { error() {} }
  });
  return { domain, observations, financialRecords, pipeline };
}

test('Coinbase trade becomes a Recognition, Financial Record, and SRA Coin Position without auto-forming an instrument', async () => {
  const { domain, observations, pipeline } = services();
  const { observation } = await seedTrade(observations);
  const result = await pipeline.processObservation(observation);

  assert.equal(result.processed, true);
  assert.equal(result.pipelineBoundary, 'COIN_POSITION');
  assert.equal(result.recognition.decision, 'RECOGNIZED');
  assert.equal(result.recognition.classification.type, 'VERIFIED_MARKET_TRANSACTION');
  assert.equal(result.recognition.measurement.method, 'SOURCE_TRANSACTION_NOTIONAL');
  assert.equal(result.recognition.measurement.value, 600);
  assert.equal(result.recognition.measurement.unit, 'USD');

  assert.equal(result.financialRecord.recordType, 'MARKET_TRANSACTION_FINANCIAL_ASSET');
  assert.equal(result.financialRecord.recognizedPosition.amount, 600);
  assert.equal(result.financialRecord.observationId, observation.observationId);

  assert.equal(result.coinPosition.symbol, 'SRA');
  assert.equal(result.coinPosition.assetIdentity, 'SRA_COIN');
  assert.equal(result.coinPosition.fungibility, 'FUNGIBLE');
  assert.equal(result.coinPosition.quantity, 600);
  assert.equal(result.coinPosition.representationType, 'TRANSACTION_FINANCIAL_ASSET_POSITION');
  assert.equal(result.coinPosition.sourceLineage.observationId, observation.observationId);
  assert.equal(result.coinPosition.state, 'REPRESENTED');
  assert.equal(result.coinPosition.restrictions.some((item) => item.type === 'MARKET_ACCESS_SUBJECT_TO_PLATFORM_WORKFLOW'), false);
  assert.equal(result.coinPosition.marketDestination, 'SRA_LIVING_MARKET');
  assert.equal(result.coinPosition.marketState, 'LIVE');
  assert.equal(result.instrument, null);

  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 1);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 1);
  assert.equal(domain.list(RECORD_TYPES.SRA_INSTRUMENT).length, 0);
});

test('a summarized Coinbase flow reaches the SRA market as one Coin Position', async () => {
  const { domain, observations, pipeline } = services();
  const { observation } = await observations.observe({
    sourceMarket: 'COINBASE', sourceRecordId: 'BTC-USD:1:1000', sourceRecordType: 'MARKET_FLOW',
    sourceTimestamp: '2026-08-04T22:01:00.000Z', connectorId: 'COINBASE_PUBLIC_MARKET_TRADES', category: 'CRYPTO_MARKET_TRANSACTION',
    rawValues: { tradeId: '1000', firstTradeId: '1', lastTradeId: '1000', tradeCount: 1000, productId: 'BTC-USD', price: 50000, lastPrice: 50010, size: 1, notional: 50000 },
    rawPayload: { productId: 'BTC-USD', tradeCount: 1000 }, sourceReference: 'coinbase:advanced-trade:market_flow:BTC-USD:1:1000'
  }, 'COINBASE_PUBLIC_MARKET_TRADES');
  const result = await pipeline.processObservation(observation);
  assert.equal(result.coinPosition.sourceTradeCount, 1000);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 1);
  const { observation: next } = await observations.observe({
    sourceMarket: 'COINBASE', sourceRecordId: 'BTC-USD:1001:1500', sourceRecordType: 'MARKET_FLOW',
    sourceTimestamp: '2026-08-04T22:02:00.000Z', connectorId: 'COINBASE_PUBLIC_MARKET_TRADES', category: 'CRYPTO_MARKET_TRANSACTION',
    rawValues: { tradeId: '1500', tradeCount: 500, productId: 'BTC-USD', price: 51000, lastPrice: 51010, size: 0.5, notional: 25500 },
    rawPayload: { productId: 'BTC-USD', tradeCount: 500 }, sourceReference: 'coinbase:advanced-trade:market_flow:BTC-USD:1001:1500'
  }, 'COINBASE_PUBLIC_MARKET_TRADES');
  const updated = await pipeline.processObservation(next);
  assert.equal(updated.coinPosition.coinPositionId, result.coinPosition.coinPositionId);
  assert.equal(updated.coinPosition.sourceTradeCount, 1500);
  assert.equal(updated.coinPosition.quantity, 75500);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 1);
  assert.equal(pipeline.status().flowPositions[0].tradeCount, 1500);
  assert.equal(pipeline.status().flowPositions[0].marketDestination, 'SRA_LIVING_MARKET');
});

test('reprocessing the same observation returns the existing coin asset chain without creating an instrument', async () => {
  const { domain, observations, pipeline } = services();
  const { observation } = await seedTrade(observations);
  const first = await pipeline.processObservation(observation);
  const second = await pipeline.processObservation(observation.observationId);

  assert.equal(second.processed, true);
  assert.equal(second.recognition.recognitionId, first.recognition.recognitionId);
  assert.equal(second.financialRecord.financialRecordId, first.financialRecord.financialRecordId);
  assert.equal(second.coinPosition.coinPositionId, first.coinPosition.coinPositionId);
  assert.equal(second.instrument, null);
  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 1);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 1);
  assert.equal(domain.list(RECORD_TYPES.SRA_INSTRUMENT).length, 0);
});

test('backfill ends at Coin Position and does not form transaction instruments', async () => {
  const { domain, observations, pipeline } = services();
  await seedTrade(observations, '9001', 600);
  await seedTrade(observations, '9002', 125);

  const status = await pipeline.backfill();

  assert.equal(status.backfillState, 'COMPLETED');
  assert.equal(status.pipelineBoundary, 'COIN_POSITION');
  assert.equal(status.instrumentsCreated, 0);
  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 2);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 2);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 2);
  assert.equal(domain.list(RECORD_TYPES.SRA_INSTRUMENT).length, 0);
  assert.equal(domain.list(RECORD_TYPES.COIN_ACCOUNT).length, 1);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT).length, 1);
});

test('source asset quantity remains separate from the recorded USD amount represented in SRA', async () => {
  const { observations, pipeline } = services();
  const { observation } = await seedTrade(observations, 'BTC-4', 420000, 105000);
  const result = await pipeline.processObservation(observation);

  assert.equal(observation.rawValues.size, 4);
  assert.equal(observation.rawValues.price, 105000);
  assert.equal(observation.rawValues.notional, 420000);
  assert.equal(result.recognition.measurement.value, 420000);
  assert.equal(result.financialRecord.recognizedPosition.amount, 420000);
  assert.equal(result.coinPosition.sourcePosition.amount, 4);
  assert.equal(result.coinPosition.sourcePosition.unit, 'BTC');
  assert.equal(result.coinPosition.recordedValue.amount, 420000);
  assert.equal(result.coinPosition.recordedValue.currency, 'USD');
  assert.equal(result.coinPosition.valuation.price, 105000);
  assert.equal(result.coinPosition.valuation.priceCurrency, 'USD');
  assert.equal(result.coinPosition.valuation.recognizedValueUsd, 420000);
  assert.equal(result.coinPosition.quantity, 420000);
});

test('non-USD Coinbase products are rejected until an explicit USD FX conversion exists', async () => {
  const { domain, observations, pipeline } = services();
  const { observation } = await seedTrade(observations, 'EUR-1', 100000, 50000, 'BTC-EUR');

  await assert.rejects(
    () => pipeline.processObservation(observation),
    (error) => error?.code === 'COINBASE_NON_USD_QUOTE_REQUIRES_FX_CONVERSION' && /BTC-EUR.*EUR.*USD valuation/i.test(error.message)
  );

  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 0);
  assert.equal(domain.list(RECORD_TYPES.FINANCIAL_RECORD).length, 0);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length, 0);
});

test('an instrument can still be created explicitly from a Coin Position when requested', async () => {
  const { domain, observations, pipeline } = services();
  const { observation } = await seedTrade(observations, 'EXPLICIT-1', 900);
  const result = await pipeline.processObservation(observation);
  const instruments = new InstrumentEngineService(domain);

  const explicit = await instruments.createFromCoinPosition(result.coinPosition.coinPositionId, {
    instrumentType: 'SRA_VALUE_INSTRUMENT',
    name: 'Explicitly Requested Instrument',
    principalQuantity: 900,
    purpose: 'EXPLICIT_INSTRUMENT_FORMATION'
  }, 'ADMIN-1');

  assert.equal(explicit.created, true);
  assert.equal(explicit.instrument.coinPositionId, result.coinPosition.coinPositionId);
  assert.equal(explicit.instrument.denomination.principalQuantity, 900);
  assert.equal(domain.list(RECORD_TYPES.SRA_INSTRUMENT).length, 1);
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
