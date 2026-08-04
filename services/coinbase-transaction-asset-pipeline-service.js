import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const ACTOR_ID = 'COINBASE_TRANSACTION_ASSET_PIPELINE';

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12).toUpperCase();
}

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}

export class CoinbaseTransactionAssetPipelineService {
  constructor({ observationLayerService, financialRecordService, persistentDomain, environment = process.env, logger = console } = {}) {
    if (!observationLayerService?.recognize) throw new Error('observationLayerService is required.');
    if (!financialRecordService?.createFromRecognition || !financialRecordService?.representAsCoin) throw new Error('financialRecordService is required.');
    this.observations = observationLayerService;
    this.financialRecords = financialRecordService;
    this.domain = persistentDomain || observationLayerService.persistentDomain;
    this.environment = environment;
    this.logger = logger;
    this.enabled = String(environment.COINBASE_TRANSACTION_ASSET_PIPELINE_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.backfillLimit = Number(environment.COINBASE_TRANSACTION_ASSET_BACKFILL_LIMIT || 5000);
    this.processed = 0;
    this.recognized = 0;
    this.financialRecordsCreated = 0;
    this.coinPositionsCreated = 0;
    this.skipped = 0;
    this.failed = 0;
    this.lastProcessedAt = null;
    this.lastError = null;
    this.backfillState = 'NOT_STARTED';
  }

  status() {
    return {
      enabled: this.enabled,
      state: this.enabled ? 'ACTIVE' : 'DISABLED',
      processed: this.processed,
      recognized: this.recognized,
      financialRecordsCreated: this.financialRecordsCreated,
      coinPositionsCreated: this.coinPositionsCreated,
      skipped: this.skipped,
      failed: this.failed,
      backfillState: this.backfillState,
      lastProcessedAt: this.lastProcessedAt,
      lastError: this.lastError
    };
  }

  eligible(observation) {
    return observation?.sourceMarket === 'COINBASE'
      && observation?.sourceRecordType === 'MARKET_TRADE'
      && observation?.category === 'CRYPTO_MARKET_TRANSACTION';
  }

  existingChain(observation) {
    const recognition = observation.currentRecognitionId
      ? this.domain.get(RECORD_TYPES.RECOGNITION_ASSESSMENT, observation.currentRecognitionId)
      : this.domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).find((item) => item.observationId === observation.observationId && item.decision === 'RECOGNIZED');
    const financialRecord = recognition
      ? this.domain.list(RECORD_TYPES.FINANCIAL_RECORD).find((item) => item.recognitionId === recognition.recognitionId && item.state !== 'SUPERSEDED')
      : null;
    const coinPosition = financialRecord
      ? this.domain.list(RECORD_TYPES.COIN_POSITION).find((item) => item.financialRecordId === financialRecord.financialRecordId && item.state !== 'RETIRED')
      : null;
    return { recognition, financialRecord, coinPosition };
  }

  async processObservation(observationOrId) {
    if (!this.enabled) return { processed: false, reason: 'PIPELINE_DISABLED' };
    const observation = typeof observationOrId === 'string' ? this.observations.get(observationOrId) : observationOrId;
    if (!observation) throw new Error('Observation not found.');
    if (!this.eligible(observation)) {
      this.skipped += 1;
      return { processed: false, reason: 'NOT_COINBASE_MARKET_TRADE' };
    }

    try {
      const raw = observation.rawValues || {};
      const productId = String(raw.productId || '').toUpperCase();
      const tradeId = String(raw.tradeId || observation.sourceRecordId || '');
      const notional = finitePositive(raw.notional, 'trade notional');
      const price = finitePositive(raw.price, 'trade price');
      const size = finitePositive(raw.size, 'trade size');
      const subjectId = `COINBASE:${productId}`;
      const key = shortHash(subjectId);
      let { recognition, financialRecord, coinPosition } = this.existingChain(observation);

      if (!recognition) {
        const result = await this.observations.recognize(observation.observationId, {
          identity: { subjectType: 'MARKET_PRODUCT', subjectId, displayName: `${productId} Coinbase transaction market` },
          authority: {
            basis: 'AUTHORIZED_PUBLIC_MARKET_DATA',
            scope: 'Record and recognize Coinbase public market transaction activity inside SRA.',
            reference: observation.sourceReference
          },
          evidence: {
            items: [
              { type: 'COINBASE_PUBLIC_TRADE_PAYLOAD', reference: observation.sourceReference },
              { type: 'SOURCE_PAYLOAD_DIGEST', digest: observation.payloadDigest }
            ]
          },
          classification: {
            type: 'VERIFIED_MARKET_TRANSACTION',
            category: 'CRYPTO_MARKET_TRANSACTION',
            description: 'A Coinbase public market trade recognized as a transaction-based financial asset record on SRA.'
          },
          relationships: [
            { type: 'MARKET_PRODUCT', id: productId },
            { type: 'SOURCE_TRADE', id: tradeId },
            { type: 'SOURCE_CONNECTOR', id: observation.connectorId }
          ],
          measurement: {
            method: 'SOURCE_TRANSACTION_NOTIONAL',
            unit: 'USD',
            value: notional,
            asOf: observation.sourceTimestamp || observation.observedAt,
            inputs: { productId, tradeId, price, size, side: raw.side || null, notional },
            methodologyReference: 'COINBASE_PRICE_MULTIPLIED_BY_EXECUTED_SIZE'
          },
          decision: 'RECOGNIZED',
          rationale: 'The source trade ID, product, time, executed price, executed size, payload, and source digest are recorded and traceable.',
          limitations: ['PUBLIC_MARKET_TRADE_DOES_NOT_INFER_UNDERLYING_CUSTOMER_IDENTITY']
        }, ACTOR_ID);
        recognition = result.recognition;
        this.recognized += 1;
      }

      if (!financialRecord) {
        const result = await this.financialRecords.createFromRecognition(recognition.recognitionId, {
          financialAccountId: `FRA-CB-${key}`,
          accountName: `${productId} Coinbase Transaction Account`,
          recordType: 'MARKET_TRANSACTION_FINANCIAL_ASSET',
          rights: [
            { type: 'SRA_RECORDED_TRANSACTION_ASSET_RIGHT', scope: 'Recorded digital financial-asset representation inside SRA.' },
            { type: 'SOURCE_LINEAGE_RIGHT', scope: 'Permanent access to the recorded source and evidence lineage.' }
          ],
          obligations: [
            { type: 'SOURCE_TRACEABILITY_OBLIGATION' },
            { type: 'VALUE_SEPARATION_OBLIGATION', scope: 'Keep source amount, Verified Value, offered price, and executed trade price separate.' }
          ],
          restrictions: [
            { type: 'NO_UNDERLYING_ACCOUNT_OWNERSHIP_INFERRED' }
          ],
          reason: 'Recognized Coinbase market transaction recorded as an SRA financial asset.'
        }, ACTOR_ID);
        financialRecord = result.financialRecord;
        if (result.created) this.financialRecordsCreated += 1;
      }

      if (!coinPosition) {
        const result = await this.financialRecords.representAsCoin(financialRecord.financialRecordId, {
          coinAccountId: `CA-CB-${key}`,
          symbol: 'SRA',
          conversionMethod: 'DIRECT_RECORDED_VALUE_RATIO',
          conversionRate: 1,
          representationType: 'TRANSACTION_FINANCIAL_ASSET_POSITION',
          methodologyReference: 'ONE_SRA_UNIT_PER_RECORDED_USD_OF_SOURCE_TRANSACTION_NOTIONAL',
          restrictions: [{ type: 'MARKET_ACCESS_SUBJECT_TO_PLATFORM_WORKFLOW' }],
          reason: 'Coinbase transaction financial asset represented as an SRA Coin Position.'
        }, ACTOR_ID);
        coinPosition = result.coinPosition;
        if (result.created) this.coinPositionsCreated += 1;
      }

      this.processed += 1;
      this.lastProcessedAt = new Date().toISOString();
      this.lastError = null;
      return { processed: true, observation, recognition, financialRecord, coinPosition };
    } catch (error) {
      this.failed += 1;
      this.lastError = { message: error?.message || String(error), observationId: observation.observationId, at: new Date().toISOString() };
      this.logger.error?.('Coinbase transaction asset pipeline error:', error);
      throw error;
    }
  }

  async backfill() {
    if (!this.enabled || this.backfillState === 'RUNNING') return this.status();
    this.backfillState = 'RUNNING';
    const observations = this.observations.list({ market: 'COINBASE', recordType: 'MARKET_TRADE' })
      .filter((item) => this.eligible(item))
      .slice(0, Number.isFinite(this.backfillLimit) && this.backfillLimit > 0 ? this.backfillLimit : 5000);
    for (const observation of observations) {
      try { await this.processObservation(observation); }
      catch { /* failure is retained in status and processing continues */ }
    }
    this.backfillState = 'COMPLETED';
    return this.status();
  }
}

export const COINBASE_TRANSACTION_ASSET_PIPELINE_ACTOR = ACTOR_ID;
