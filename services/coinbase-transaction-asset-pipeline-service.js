import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { InstrumentEngineService } from './instrument-engine-service.js';

const ACTOR_ID = 'COINBASE_TRANSACTION_ASSET_PIPELINE';
const PLATFORM_OWNER_ID = 'SRA_PLATFORM';

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12).toUpperCase();
}

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}

function productAssets(productId) {
  const value = String(productId || '').trim().toUpperCase();
  const parts = value.split('-');
  if (parts.length < 2 || !parts[0] || !parts[parts.length - 1]) throw new Error('Coinbase product must include base and quote assets.');
  return { baseAsset: parts[0], quoteAsset: parts[parts.length - 1] };
}

export class CoinbaseTransactionAssetPipelineService {
  constructor({ observationLayerService, financialRecordService, persistentDomain, instrumentEngineService, environment = process.env, logger = console } = {}) {
    if (!observationLayerService?.recognize) throw new Error('observationLayerService is required.');
    if (!financialRecordService?.createFromRecognition || !financialRecordService?.representAsCoin) throw new Error('financialRecordService is required.');
    this.observations = observationLayerService;
    this.financialRecords = financialRecordService;
    this.domain = persistentDomain || observationLayerService.persistentDomain;
    this.environment = environment;
    this.logger = logger;
    this.enabled = String(environment.COINBASE_TRANSACTION_ASSET_PIPELINE_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.instrumentFormationEnabled = String(environment.COINBASE_TRANSACTION_INSTRUMENT_FORMATION_ENABLED ?? 'false').toLowerCase() === 'true';
    this.instrumentEngine = instrumentEngineService || new InstrumentEngineService(this.domain);
    this.backfillLimit = Number(environment.COINBASE_TRANSACTION_ASSET_BACKFILL_LIMIT || 5000);
    this.processed = 0;
    this.recognized = 0;
    this.financialRecordsCreated = 0;
    this.coinPositionsCreated = 0;
    this.instrumentsCreated = 0;
    this.skipped = 0;
    this.failed = 0;
    this.lastProcessedAt = null;
    this.lastError = null;
    this.backfillState = 'NOT_STARTED';
    this.flowPositions = new Map();
  }

  status() {
    return {
      enabled: this.enabled,
      state: this.enabled ? 'ACTIVE' : 'DISABLED',
      instrumentFormationEnabled: this.instrumentFormationEnabled,
      pipelineBoundary: this.instrumentFormationEnabled ? 'SRA_INSTRUMENT' : 'COIN_POSITION',
      processed: this.processed,
      recognized: this.recognized,
      financialRecordsCreated: this.financialRecordsCreated,
      coinPositionsCreated: this.coinPositionsCreated,
      instrumentsCreated: this.instrumentsCreated,
      skipped: this.skipped,
      failed: this.failed,
      backfillState: this.backfillState,
      lastProcessedAt: this.lastProcessedAt,
      lastError: this.lastError,
      marketDestination: 'SRA_LIVING_MARKET',
      flowPositions: [...this.flowPositions.values()]
    };
  }

  eligible(observation) {
    return observation?.sourceMarket === 'COINBASE'
      && ['MARKET_TRADE', 'MARKET_FLOW'].includes(observation?.sourceRecordType)
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
    const linkedInstrumentId = coinPosition?.instrumentId || coinPosition?.linkedInstrumentId || null;
    const instrument = linkedInstrumentId
      ? this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, linkedInstrumentId)
      : coinPosition
        ? this.domain.list(RECORD_TYPES.SRA_INSTRUMENT).find((item) => item.coinPositionId === coinPosition.coinPositionId && !['CANCELLED', 'MATURED', 'CLOSED'].includes(item.state))
        : null;
    return { recognition, financialRecord, coinPosition, instrument };
  }

  async ensurePlatformOwnership(coinPosition) {
    if (!coinPosition || coinPosition.ownerId) return coinPosition;
    const updatedAt = new Date().toISOString();
    const updated = {
      ...coinPosition,
      ownerId: PLATFORM_OWNER_ID,
      ownerType: 'PLATFORM',
      initialOwnerId: PLATFORM_OWNER_ID,
      ownershipState: 'PLATFORM_OWNED',
      ownershipBasis: 'VERIFIED_COINBASE_TRANSACTION_RECORD',
      updatedAt
    };
    await this.domain.put(RECORD_TYPES.COIN_POSITION, coinPosition.coinPositionId, updated, {
      actorId: ACTOR_ID,
      eventType: 'COINBASE_SRA_PLATFORM_OWNERSHIP_RECORDED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.COIN_POSITION,
      objectId: coinPosition.coinPositionId,
      eventType: 'COINBASE_SRA_PLATFORM_OWNERSHIP_RECORDED',
      actorId: ACTOR_ID,
      payload: {
        ownerId: PLATFORM_OWNER_ID,
        initialOwnerId: PLATFORM_OWNER_ID,
        ownershipState: 'PLATFORM_OWNED',
        ownershipBasis: 'VERIFIED_COINBASE_TRANSACTION_RECORD'
      }
    });
    return updated;
  }

  async ensureNativeSourceValuation(coinPosition, observation, { productId, tradeId, price, size, notional, nativeUnit, quoteCurrency, tradeCount = 1 }) {
    if (!coinPosition) return coinPosition;
    const expectedSourcePosition = {
      amount: size,
      unit: nativeUnit,
      asOf: observation.sourceTimestamp || observation.observedAt,
      basis: 'COINBASE_EXECUTED_SIZE'
    };
    const alreadyCorrect = Number(coinPosition.sourcePosition?.amount) === size
      && String(coinPosition.sourcePosition?.unit || '').toUpperCase() === nativeUnit
      && Number(coinPosition.recordedValue?.amount) === notional
      && String(coinPosition.recordedValue?.currency || '').toUpperCase() === quoteCurrency;
    if (alreadyCorrect) return coinPosition;

    const updatedAt = new Date().toISOString();
    const updated = {
      ...coinPosition,
      symbol: 'SRA',
      assetIdentity: 'SRA_COIN',
      assetName: 'SRA Coin',
      fungibility: 'FUNGIBLE',
      restrictions: (coinPosition.restrictions || []).filter((restriction) => restriction?.type !== 'MARKET_ACCESS_SUBJECT_TO_PLATFORM_WORKFLOW'),
      sourcePosition: expectedSourcePosition,
      nativeQuantity: size,
      nativeUnit,
      recordedValue: { amount: notional, currency: quoteCurrency },
      representedValueUsd: notional,
      availableQuantity: Number(coinPosition.quantity || notional),
      marketDestination: 'SRA_LIVING_MARKET',
      marketState: 'LIVE',
      sourceFlow: 'COINBASE_PUBLIC_MARKET',
      sourceTradeCount: tradeCount,
      valuation: {
        method: 'COINBASE_EXECUTED_PRICE_TIMES_SIZE',
        source: 'COINBASE',
        productId,
        tradeId,
        nativeQuantity: size,
        nativeUnit,
        price,
        priceCurrency: quoteCurrency,
        recognizedValueUsd: notional,
        asOf: observation.sourceTimestamp || observation.observedAt
      },
      conversionRule: {
        ...(coinPosition.conversionRule || {}),
        method: 'RECORDED_USD_VALUE_AT_PAR',
        rate: 1,
        sourceUnit: 'USD',
        originalSourceUnit: nativeUnit,
        coinUnit: 'SRA',
        methodologyReference: 'ONE_SRA_UNIT_PER_RECORDED_USD_OF_SOURCE_TRANSACTION_NOTIONAL'
      },
      updatedAt
    };

    await this.domain.put(RECORD_TYPES.COIN_POSITION, coinPosition.coinPositionId, updated, {
      actorId: ACTOR_ID,
      eventType: 'COINBASE_NATIVE_SOURCE_AND_USD_VALUATION_RECORDED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.COIN_POSITION,
      objectId: coinPosition.coinPositionId,
      eventType: 'COINBASE_NATIVE_SOURCE_AND_USD_VALUATION_RECORDED',
      actorId: ACTOR_ID,
      payload: {
        nativeQuantity: size,
        nativeUnit,
        price,
        priceCurrency: quoteCurrency,
        recognizedValueUsd: notional,
        representedSra: Number(updated.quantity || 0)
      }
    });
    return updated;
  }

  async ensureInstrument(coinPosition, financialRecord, observation, { productId, tradeId }) {
    if (!this.instrumentFormationEnabled) return null;
    const result = await this.instrumentEngine.createFromCoinPosition(coinPosition.coinPositionId, {
      instrumentType: 'SRA_VALUE_INSTRUMENT',
      name: `${productId} Recorded Market Transaction Instrument`,
      holder: {
        type: coinPosition.ownerType || 'PLATFORM',
        id: coinPosition.ownerId || PLATFORM_OWNER_ID
      },
      purpose: 'RECORDED_MARKET_TRANSACTION_OBLIGATION',
      settlementUnit: coinPosition.symbol || 'SRA',
      transferability: 'RESTRICTED',
      governingReference: financialRecord.financialRecordId,
      conditions: [
        {
          type: 'SOURCE_TRANSACTION_LINEAGE',
          source: 'COINBASE',
          productId,
          tradeId,
          observationId: observation.observationId,
          financialRecordId: financialRecord.financialRecordId
        }
      ],
      reason: 'Coinbase-recognized transaction financial asset formalized as an SRA obligation-bearing instrument.'
    }, ACTOR_ID);
    if (result.created) this.instrumentsCreated += 1;

    let instrument = result.instrument;
    if (['DRAFT', 'RECORDED'].includes(String(instrument.state || '').toUpperCase())) {
      instrument = await this.instrumentEngine.changeState(instrument.instrumentId, {
        state: 'REVIEW_REQUIRED',
        reason: 'Coin Position propagation is complete. The obligation-bearing SRA instrument is queued for Platform Administration approval before downstream representation or marketplace use.'
      }, ACTOR_ID);
    }
    return instrument;
  }

  async processConsolidatedMarketFlow(observation) {
    const raw = observation.rawValues || {};
    const productId = String(raw.productId || '').toUpperCase();
    const { baseAsset: nativeUnit, quoteAsset: quoteCurrency } = productAssets(productId);
    if (quoteCurrency !== 'USD') {
      const error = new Error(`Coinbase product ${productId} is quoted in ${quoteCurrency}. SRA par representation requires an explicit USD valuation and does not infer FX conversion.`);
      error.code = 'COINBASE_NON_USD_QUOTE_REQUIRES_FX_CONVERSION';
      throw error;
    }
    const price = finitePositive(raw.price, 'flow price');
    const size = finitePositive(raw.size, 'flow size');
    const notional = finitePositive(raw.notional, 'flow notional');
    const tradeCount = Math.max(1, Number(raw.tradeCount || 1));
    const key = shortHash(`COINBASE:${productId}`);
    const ids = { recognition: `REC-CB-FLOW-${key}`, account: `FRA-CB-${key}`, financialRecord: `FR-CB-FLOW-${key}`, coinAccount: `CA-CB-${key}`, coinPosition: `CP-CB-FLOW-${key}` };
    const load = async (type, id) => this.domain.hydrateRecord ? this.domain.hydrateRecord(type, id) : this.domain.get(type, id);
    const [priorRecognition, priorAccount, priorRecord, priorCoinAccount, priorPosition] = await Promise.all([
      load(RECORD_TYPES.RECOGNITION_ASSESSMENT, ids.recognition), load(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, ids.account),
      load(RECORD_TYPES.FINANCIAL_RECORD, ids.financialRecord), load(RECORD_TYPES.COIN_ACCOUNT, ids.coinAccount), load(RECORD_TYPES.COIN_POSITION, ids.coinPosition)
    ]);
    if (priorPosition?.lastFlowObservationId === observation.observationId) return { processed: true, observation, recognition: priorRecognition, financialRecord: priorRecord, coinPosition: priorPosition, instrument: null, pipelineBoundary: 'COIN_POSITION' };
    const timestamp = observation.sourceTimestamp || observation.observedAt || new Date().toISOString();
    const cumulative = {
      tradeCount: Number(priorPosition?.sourceTradeCount || 0) + tradeCount,
      batchCount: Number(priorPosition?.sourceBatchCount || 0) + 1,
      nativeQuantity: Number((Number(priorPosition?.sourcePosition?.amount || 0) + size).toFixed(8)),
      representedSra: Number((Number(priorPosition?.quantity || 0) + notional).toFixed(8))
    };
    const subject = { subjectType: 'MARKET_PRODUCT', subjectId: `COINBASE:${productId}`, displayName: `${productId} Coinbase market flow` };
    const recognition = { ...(priorRecognition || {}), recognitionId: ids.recognition, observationId: observation.observationId, engine: 'SAIN_RECOGNITION_ENGINE', version: 3, phase: 2, identity: subject, source: { market: 'COINBASE', sourceRecordId: observation.sourceRecordId, sourceRecordType: 'MARKET_FLOW', payloadDigest: observation.payloadDigest, sourceReference: observation.sourceReference, sourceTimestamp: timestamp, observedAt: observation.observedAt }, authority: { basis: 'AUTHORIZED_PUBLIC_MARKET_DATA', scope: 'Record and recognize summarized Coinbase public market activity inside SRA.', reference: observation.sourceReference }, evidence: { items: [{ type: 'COINBASE_PUBLIC_MARKET_FLOW', reference: observation.sourceReference }], sourcePayloadIncluded: true }, classification: { type: 'VERIFIED_MARKET_TRANSACTION', category: observation.category, description: 'Summarized Coinbase market activity recognized as one SRA market flow.' }, relationships: [{ type: 'MARKET_PRODUCT', id: productId }, { type: 'SOURCE_CONNECTOR', id: observation.connectorId }], measurement: { method: 'SOURCE_TRANSACTION_NOTIONAL', unit: 'USD', value: cumulative.representedSra, asOf: timestamp, inputs: raw, methodologyReference: 'COINBASE_FLOW_NOTIONAL' }, decision: 'RECOGNIZED', state: 'RECOGNIZED', assessedBy: ACTOR_ID, assessedAt: timestamp };
    const account = { ...(priorAccount || {}), financialAccountId: ids.account, name: `${productId} Coinbase Market Flow Account`, subjectType: subject.subjectType, subjectId: subject.subjectId, currencyOrUnit: 'USD', state: 'ACTIVE', recordCount: 1, latestFinancialRecordId: ids.financialRecord, createdBy: priorAccount?.createdBy || ACTOR_ID, createdAt: priorAccount?.createdAt || timestamp, updatedAt: timestamp };
    const financialRecord = { ...(priorRecord || {}), financialRecordId: ids.financialRecord, financialAccountId: ids.account, recognitionId: ids.recognition, observationId: observation.observationId, recordType: 'MARKET_FLOW_FINANCIAL_ASSET', identity: subject, source: recognition.source, authority: recognition.authority, evidence: recognition.evidence, classification: recognition.classification, relationships: recognition.relationships, measurement: recognition.measurement, recognizedPosition: { amount: cumulative.representedSra, unit: 'USD', asOf: timestamp, basis: 'CUMULATIVE_SOURCE_TRANSACTION_NOTIONAL' }, rights: [{ type: 'SRA_RECORDED_TRANSACTION_ASSET_RIGHT', scope: 'Recorded digital financial-asset representation inside SRA.' }], obligations: [{ type: 'SOURCE_TRACEABILITY_OBLIGATION' }], restrictions: [{ type: 'NO_UNDERLYING_ACCOUNT_OWNERSHIP_INFERRED' }], state: 'RECORDED', phase: 3, version: 3, recordedBy: priorRecord?.recordedBy || ACTOR_ID, recordedAt: priorRecord?.recordedAt || timestamp, updatedAt: timestamp };
    const coinAccount = { ...(priorCoinAccount || {}), coinAccountId: ids.coinAccount, financialAccountId: ids.account, subjectType: subject.subjectType, subjectId: subject.subjectId, symbol: 'SRA', state: 'ACTIVE', positionCount: 1, representedQuantity: cumulative.representedSra, createdBy: priorCoinAccount?.createdBy || ACTOR_ID, createdAt: priorCoinAccount?.createdAt || timestamp, updatedAt: timestamp };
    const coinPosition = { ...(priorPosition || {}), coinPositionId: ids.coinPosition, coinAccountId: ids.coinAccount, financialRecordId: ids.financialRecord, financialAccountId: ids.account, recognitionId: ids.recognition, observationId: observation.observationId, symbol: 'SRA', assetIdentity: 'SRA_COIN', assetName: 'SRA Coin', fungibility: 'FUNGIBLE', representationType: 'CONSOLIDATED_MARKET_FLOW_POSITION', sourcePosition: { amount: cumulative.nativeQuantity, unit: nativeUnit, asOf: timestamp, basis: 'COINBASE_MARKET_FLOW' }, nativeQuantity: cumulative.nativeQuantity, nativeUnit, recordedValue: { amount: cumulative.representedSra, currency: 'USD' }, representedValueUsd: cumulative.representedSra, conversionRule: { method: 'RECORDED_USD_VALUE_AT_PAR', rate: 1, sourceUnit: 'USD', originalSourceUnit: nativeUnit, coinUnit: 'SRA', methodologyReference: 'ONE_SRA_UNIT_PER_RECORDED_USD_OF_SOURCE_TRANSACTION_NOTIONAL' }, quantity: cumulative.representedSra, availableQuantity: cumulative.representedSra, ownerId: PLATFORM_OWNER_ID, ownerType: 'PLATFORM', initialOwnerId: PLATFORM_OWNER_ID, ownershipState: 'PLATFORM_OWNED', ownershipBasis: 'VERIFIED_COINBASE_MARKET_FLOW', rights: financialRecord.rights, obligations: financialRecord.obligations, restrictions: financialRecord.restrictions, marketDestination: 'SRA_LIVING_MARKET', marketState: 'LIVE', sourceFlow: 'COINBASE_PUBLIC_MARKET', sourceTradeCount: cumulative.tradeCount, sourceBatchCount: cumulative.batchCount, lastFlowObservationId: observation.observationId, valuation: { method: 'COINBASE_FLOW_VWAP_TIMES_QUANTITY', source: 'COINBASE', productId, nativeQuantity: size, nativeUnit, price, lastPrice: Number(raw.lastPrice || price), priceCurrency: 'USD', recognizedValueUsd: notional, asOf: timestamp }, sourceLineage: { latestObservationId: observation.observationId, source: recognition.source, evidence: recognition.evidence }, state: 'REPRESENTED', phase: 4, version: 4, representedBy: priorPosition?.representedBy || ACTOR_ID, representedAt: priorPosition?.representedAt || timestamp, updatedAt: timestamp };
    const updatedObservation = { ...observation, recognitionState: 'RECOGNIZED', currentRecognitionId: ids.recognition, lastRecognizedAt: timestamp, lastRecognizedBy: ACTOR_ID };
    const changes = [[RECORD_TYPES.MARKET_OBSERVATION, observation.observationId, updatedObservation], [RECORD_TYPES.RECOGNITION_ASSESSMENT, ids.recognition, recognition], [RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, ids.account, account], [RECORD_TYPES.FINANCIAL_RECORD, ids.financialRecord, financialRecord], [RECORD_TYPES.COIN_ACCOUNT, ids.coinAccount, coinAccount], [RECORD_TYPES.COIN_POSITION, ids.coinPosition, coinPosition]];
    if (this.domain.atomicPut) await this.domain.atomicPut(changes.map(([type, id, payload]) => ({ type, id, payload, actorId: ACTOR_ID, eventType: 'COINBASE_MARKET_FLOW_UPDATED', audit: false })));
    else for (const [type, id, payload] of changes) await this.domain.put(type, id, payload);
    if (!priorRecognition) this.recognized += 1;
    if (!priorRecord) this.financialRecordsCreated += 1;
    if (!priorPosition) this.coinPositionsCreated += 1;
    this.processed += 1;
    this.lastProcessedAt = timestamp;
    this.flowPositions.set(productId, { productId, nativeUnit, tradeCount: cumulative.tradeCount, batchCount: cumulative.batchCount, nativeQuantity: cumulative.nativeQuantity, representedSra: cumulative.representedSra, lastPrice: Number(raw.lastPrice || price), marketDestination: 'SRA_LIVING_MARKET', marketState: 'LIVE', latestCoinPositionId: ids.coinPosition, updatedAt: timestamp });
    return { processed: true, observation: updatedObservation, recognition, financialRecord, coinPosition, instrument: null, pipelineBoundary: 'COIN_POSITION' };
  }

  async processObservation(observationOrId) {
    if (!this.enabled) return { processed: false, reason: 'PIPELINE_DISABLED' };
    const observation = typeof observationOrId === 'string' ? this.observations.get(observationOrId) : observationOrId;
    if (!observation) throw new Error('Observation not found.');
    if (!this.eligible(observation)) {
      this.skipped += 1;
      return { processed: false, reason: 'NOT_COINBASE_MARKET_TRADE' };
    }

    if (observation.sourceRecordType === 'MARKET_FLOW') {
      try { return await this.processConsolidatedMarketFlow(observation); }
      catch (error) { this.failed += 1; this.lastError = { message: error?.message || String(error), observationId: observation.observationId, at: new Date().toISOString() }; throw error; }
    }

    try {
      const raw = observation.rawValues || {};
      const productId = String(raw.productId || '').toUpperCase();
      const { baseAsset: nativeUnit, quoteAsset: quoteCurrency } = productAssets(productId);
      if (quoteCurrency !== 'USD') {
        const error = new Error(`Coinbase product ${productId} is quoted in ${quoteCurrency}. SRA par representation requires an explicit USD valuation and does not infer FX conversion.`);
        error.code = 'COINBASE_NON_USD_QUOTE_REQUIRES_FX_CONVERSION';
        throw error;
      }
      const tradeId = String(raw.tradeId || observation.sourceRecordId || '');
      const tradeCount = Math.max(1, Number(raw.tradeCount || 1));
      const notional = finitePositive(raw.notional, 'trade notional');
      const price = finitePositive(raw.price, 'trade price');
      const size = finitePositive(raw.size, 'trade size');
      const subjectId = `COINBASE:${productId}`;
      const key = shortHash(subjectId);
      let { recognition, financialRecord, coinPosition, instrument } = this.existingChain(observation);

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
            unit: quoteCurrency,
            value: notional,
            asOf: observation.sourceTimestamp || observation.observedAt,
            inputs: { productId, tradeId, price, size, nativeAsset: nativeUnit, quoteAsset: quoteCurrency, side: raw.side || null, notional },
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
            { type: 'VALUE_SEPARATION_OBLIGATION', scope: 'Keep source quantity, recorded USD value, offered price, and executed trade price separate.' }
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
          reason: 'Coinbase transaction financial asset represented as an SRA Coin Position.'
        }, ACTOR_ID);
        coinPosition = result.coinPosition;
        if (result.created) this.coinPositionsCreated += 1;
      }

      coinPosition = await this.ensureNativeSourceValuation(coinPosition, observation, { productId, tradeId, price, size, notional, nativeUnit, quoteCurrency, tradeCount });
      coinPosition = await this.ensurePlatformOwnership(coinPosition);
      instrument = await this.ensureInstrument(coinPosition, financialRecord, observation, { productId, tradeId });
      if (instrument) {
        coinPosition = this.domain.get(RECORD_TYPES.COIN_POSITION, coinPosition.coinPositionId) || coinPosition;
      }

      this.processed += 1;
      const priorFlow = this.flowPositions.get(productId) || { productId, nativeUnit, tradeCount: 0, batchCount: 0, nativeQuantity: 0, representedSra: 0 };
      this.flowPositions.set(productId, {
        ...priorFlow,
        productId,
        nativeUnit,
        tradeCount: Number(priorFlow.tradeCount || 0) + tradeCount,
        batchCount: Number(priorFlow.batchCount || 0) + 1,
        nativeQuantity: Number((Number(priorFlow.nativeQuantity || 0) + size).toFixed(8)),
        representedSra: Number((Number(priorFlow.representedSra || 0) + notional).toFixed(8)),
        lastPrice: Number(raw.lastPrice || price),
        marketDestination: 'SRA_LIVING_MARKET',
        marketState: 'LIVE',
        latestCoinPositionId: coinPosition.coinPositionId,
        updatedAt: observation.sourceTimestamp || observation.observedAt
      });
      this.lastProcessedAt = new Date().toISOString();
      this.lastError = null;
      return {
        processed: true,
        observation,
        recognition,
        financialRecord,
        coinPosition,
        instrument,
        pipelineBoundary: instrument ? 'SRA_INSTRUMENT' : 'COIN_POSITION'
      };
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
    const observations = this.observations.list({ market: 'COINBASE' })
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
