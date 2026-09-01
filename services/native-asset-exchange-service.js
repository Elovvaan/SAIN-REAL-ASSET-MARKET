import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const QUOTE_TYPE = 'NATIVE_ASSET_EXCHANGE_QUOTE';
const EXCHANGE_TYPE = RECORD_TYPES.ASSET_CONVERSION;
const NATIVE_ASSET_ID = 'SRA-USD';
const SUPPORTED = Object.freeze({
  XLM: { network: 'STELLAR', decimals: 7, canonicalAssetId: 'STELLAR-XLM' },
  XRP: { network: 'XRPL', decimals: 6, canonicalAssetId: 'XRPL-XRP' },
});

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;

function positive(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be greater than zero.`);
  return parsed;
}

function sraAmount(value) {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) throw new Error('fromAmount must be a positive SRA/USD amount with no more than 2 decimal places.');
  return Number(raw);
}

function roundDown(value, decimals) {
  const scale = 10 ** decimals;
  return Math.floor((value + Number.EPSILON) * scale) / scale;
}

function quoteTime(observation) {
  return observation?.sourceTimestamp || observation?.observedAt || null;
}

export class NativeAssetExchangeService {
  constructor({ domain, directAccounts, transfers, quoteMaxAgeMs = 120000, quoteTtlMs = 60000 } = {}) {
    if (!domain || !directAccounts || !transfers) throw new Error('domain, directAccounts, and transfers are required.');
    this.domain = domain;
    this.directAccounts = directAccounts;
    this.transfers = transfers;
    this.quoteMaxAgeMs = quoteMaxAgeMs;
    this.quoteTtlMs = quoteTtlMs;
  }

  supportedAssets() {
    return Object.entries(SUPPORTED).map(([asset, definition]) => ({ asset, ...definition }));
  }

  getQuote(quoteId) { return this.domain.get(QUOTE_TYPE, text(quoteId)); }
  getExchange(exchangeId) { return this.domain.get(EXCHANGE_TYPE, text(exchangeId)); }

  latestObservation(asset) {
    const productId = `${asset}-USD`;
    return this.domain.list(RECORD_TYPES.MARKET_OBSERVATION)
      .filter((record) => record.sourceMarket === 'COINBASE')
      .filter((record) => record.sourceRecordType === 'MARKET_TRADE')
      .filter((record) => upper(record.rawValues?.productId) === productId)
      .filter((record) => Number(record.rawValues?.price) > 0)
      .sort((a, b) => String(quoteTime(b)).localeCompare(String(quoteTime(a))))[0] || null;
  }

  async quote(input = {}, actorId = null) {
    const account = this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, text(input.directValueAccountId));
    if (!account) throw new Error('Direct Value Account not found.');
    const asset = upper(input.toAsset);
    const definition = SUPPORTED[asset];
    if (!definition) throw new Error('Only native XLM and XRP exchange payouts are supported.');
    const fromAmount = sraAmount(input.fromAmount);
    const source = this.directAccounts.getPosition(account.directValueAccountId, NATIVE_ASSET_ID, 'NATIVE');
    if (!source || Number(source.available) < fromAmount) throw new Error('Available SRA/USD balance is insufficient.');

    const observation = this.latestObservation(asset);
    if (!observation) {
      const error = new Error(`A current ${asset}-USD market observation is required before quoting.`);
      error.code = 'NATIVE_EXCHANGE_MARKET_OBSERVATION_REQUIRED';
      throw error;
    }
    const observedAt = quoteTime(observation);
    const ageMs = Date.now() - new Date(observedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < -30000 || ageMs > this.quoteMaxAgeMs) {
      const error = new Error(`${asset}-USD market observation is stale; wait for a current market event before quoting.`);
      error.code = 'NATIVE_EXCHANGE_MARKET_OBSERVATION_STALE';
      throw error;
    }
    const priceUsd = positive(observation.rawValues.price, 'market price');
    const toAmount = roundDown(fromAmount / priceUsd, definition.decimals);
    if (toAmount <= 0) throw new Error('Quoted payout is below the network asset precision.');
    const createdAt = now();
    const quoteId = id('AVQ');
    const quote = {
      id: quoteId,
      quoteId,
      directValueAccountId: account.directValueAccountId,
      fromAssetId: NATIVE_ASSET_ID,
      fromNetwork: 'NATIVE',
      fromAmount: Number(fromAmount.toFixed(2)),
      toAsset: asset,
      toAssetId: definition.canonicalAssetId,
      toNetwork: definition.network,
      toAmount,
      priceUsd,
      destinationAddress: text(input.destinationAddress) || null,
      pricingSource: 'COINBASE_PUBLIC_MARKET_OBSERVATION',
      observationId: observation.observationId,
      sourceTimestamp: observedAt,
      state: 'OPEN',
      createdBy: actorId,
      createdAt,
      expiresAt: new Date(Date.now() + this.quoteTtlMs).toISOString(),
    };
    await this.domain.put(QUOTE_TYPE, quoteId, quote, { actorId, eventType: 'NATIVE_ASSET_EXCHANGE_QUOTED' });
    return quote;
  }

  async execute(input = {}, actorId = null) {
    const quote = this.getQuote(input.quoteId);
    if (!quote) throw new Error('Native-asset exchange quote not found.');
    if (quote.state === 'CONSUMED' && quote.exchangeId) return { created: false, exchange: this.getExchange(quote.exchangeId) };
    if (quote.state !== 'OPEN') throw new Error(`Native-asset exchange quote is ${quote.state.toLowerCase()}.`);
    if (new Date(quote.expiresAt).getTime() <= Date.now()) {
      await this.domain.put(QUOTE_TYPE, quote.quoteId, { ...quote, state: 'EXPIRED', updatedAt: now() }, { actorId, eventType: 'NATIVE_ASSET_EXCHANGE_QUOTE_EXPIRED' });
      throw new Error('Native-asset exchange quote has expired.');
    }
    const destinationAddress = text(input.destinationAddress || quote.destinationAddress);
    if (!destinationAddress) throw new Error('destinationAddress is required.');
    if (quote.destinationAddress && destinationAddress !== quote.destinationAddress) throw new Error('destinationAddress does not match the quoted destination.');

    const source = this.directAccounts.getPosition(quote.directValueAccountId, NATIVE_ASSET_ID, 'NATIVE');
    if (!source || Number(source.available) < quote.fromAmount) throw new Error('Available SRA/USD balance is insufficient.');
    const exchangeId = id('AVX');
    const transferId = `OCT-${exchangeId}`;
    const startedAt = now();
    const lockedPosition = {
      ...source,
      available: Number((Number(source.available) - quote.fromAmount).toFixed(8)),
      restricted: Number((Number(source.restricted || 0) + quote.fromAmount).toFixed(8)),
      updatedAt: startedAt,
    };
    const executing = {
      id: exchangeId,
      conversionId: exchangeId,
      exchangeId,
      quoteId: quote.quoteId,
      directValueAccountId: quote.directValueAccountId,
      fromAssetId: NATIVE_ASSET_ID,
      fromNetwork: 'NATIVE',
      fromAmount: quote.fromAmount,
      toAssetId: quote.toAssetId,
      toAsset: quote.toAsset,
      toNetwork: quote.toNetwork,
      toAmount: quote.toAmount,
      executedRate: Number((quote.toAmount / quote.fromAmount).toFixed(12)),
      priceUsd: quote.priceUsd,
      pricingSource: quote.pricingSource,
      observationId: quote.observationId,
      destinationAddress,
      transferId,
      state: 'EXECUTING',
      executedBy: actorId,
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    await this.domain.atomicPut([
      { type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: source.positionId, payload: lockedPosition, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_VALUE_LOCKED' },
      { type: EXCHANGE_TYPE, id: exchangeId, payload: executing, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_EXECUTION_STARTED' },
      { type: QUOTE_TYPE, id: quote.quoteId, payload: { ...quote, state: 'EXECUTING', exchangeId, updatedAt: startedAt }, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_QUOTE_ACCEPTED' },
    ]);

    try {
      const transfer = await this.transfers.send({
        transferId,
        network: quote.toNetwork,
        asset: quote.toAsset,
        amount: String(quote.toAmount),
        destinationAddress,
      }, actorId);
      if (transfer.state === 'FAILED' && transfer.confirmation?.state === 'FAILED') {
        const error = new Error('Blockchain transaction was validated as failed; no native asset was delivered.');
        error.definitiveFailure = true;
        throw error;
      }
      if (transfer.state !== 'CONFIRMED' || transfer.confirmation?.state !== 'CONFIRMED') {
        const pending = { ...executing, state: 'RECONCILIATION_REQUIRED', transactionId: transfer.transactionId || null, confirmation: transfer.confirmation || null, updatedAt: now() };
        await this.domain.put(EXCHANGE_TYPE, exchangeId, pending, { actorId, eventType: 'NATIVE_ASSET_EXCHANGE_RECONCILIATION_REQUIRED' });
        return { created: true, exchange: pending, transfer };
      }

      const current = this.directAccounts.getPosition(quote.directValueAccountId, NATIVE_ASSET_ID, 'NATIVE');
      if (!current || Number(current.restricted || 0) < quote.fromAmount) throw new Error('Locked SRA/USD balance is unavailable for exchange completion.');
      const completedAt = now();
      const completedPosition = {
        ...current,
        restricted: Number((Number(current.restricted) - quote.fromAmount).toFixed(8)),
        total: Number((Number(current.total) - quote.fromAmount).toFixed(8)),
        updatedAt: completedAt,
      };
      const completed = {
        ...executing,
        state: 'COMPLETED',
        transactionId: transfer.transactionId,
        confirmation: transfer.confirmation,
        executedAt: completedAt,
        updatedAt: completedAt,
      };
      await this.domain.atomicPut([
        { type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: current.positionId, payload: completedPosition, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_SOURCE_DEBITED' },
        { type: EXCHANGE_TYPE, id: exchangeId, payload: completed, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_COMPLETED' },
        { type: QUOTE_TYPE, id: quote.quoteId, payload: { ...quote, state: 'CONSUMED', exchangeId, transactionId: transfer.transactionId, consumedAt: completedAt, updatedAt: completedAt }, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_QUOTE_CONSUMED' },
      ]);
      await this.directAccounts.recordMovement({
        kind: 'VERIFIED_NATIVE_ASSET_EXCHANGE',
        directValueAccountId: quote.directValueAccountId,
        canonicalAssetId: NATIVE_ASSET_ID,
        network: 'NATIVE',
        direction: 'DEBIT',
        amount: quote.fromAmount,
        counterAssetId: quote.toAssetId,
        counterAmount: quote.toAmount,
        destinationAddress,
        transactionId: transfer.transactionId,
        transferId,
        state: 'CONFIRMED',
      }, actorId, 'NATIVE_ASSET_EXCHANGE_COMPLETED');
      return { created: true, exchange: completed, transfer, sourcePosition: completedPosition };
    } catch (error) {
      const submitted = this.transfers.get?.(transferId);
      if (!error?.definitiveFailure && (submitted?.transactionId || error?.transactionId || error?.transactionSignature)) {
        const uncertain = { ...executing, state: 'RECONCILIATION_REQUIRED', transactionId: submitted?.transactionId || error.transactionId || error.transactionSignature, error: text(error.message), updatedAt: now() };
        await this.domain.put(EXCHANGE_TYPE, exchangeId, uncertain, { actorId, eventType: 'NATIVE_ASSET_EXCHANGE_RECONCILIATION_REQUIRED' });
        return { created: true, exchange: uncertain, transfer: submitted || null };
      }
      const current = this.directAccounts.getPosition(quote.directValueAccountId, NATIVE_ASSET_ID, 'NATIVE');
      const failedAt = now();
      const unlocked = {
        ...current,
        available: Number((Number(current.available) + quote.fromAmount).toFixed(8)),
        restricted: Number((Number(current.restricted) - quote.fromAmount).toFixed(8)),
        updatedAt: failedAt,
      };
      const failed = { ...executing, state: 'FAILED', error: text(error.message), failedAt, updatedAt: failedAt };
      await this.domain.atomicPut([
        { type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: current.positionId, payload: unlocked, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_VALUE_RELEASED' },
        { type: EXCHANGE_TYPE, id: exchangeId, payload: failed, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_FAILED' },
        { type: QUOTE_TYPE, id: quote.quoteId, payload: { ...quote, state: 'FAILED', exchangeId, updatedAt: failedAt }, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_QUOTE_FAILED' },
      ]);
      throw error;
    }
  }

  async reconcile(exchangeId, actorId = null) {
    const exchange = this.getExchange(exchangeId);
    if (!exchange) throw new Error('Native-asset exchange not found.');
    if (exchange.state !== 'RECONCILIATION_REQUIRED') return { exchange, reconciled: false };
    const quote = this.getQuote(exchange.quoteId);
    if (!quote) throw new Error('Native-asset exchange quote not found.');
    const transfer = await this.transfers.reconcile(exchange.transferId, actorId);
    if (!['CONFIRMED', 'FAILED'].includes(transfer.state)) return { exchange, transfer, reconciled: false };

    const current = this.directAccounts.getPosition(exchange.directValueAccountId, NATIVE_ASSET_ID, 'NATIVE');
    if (!current || Number(current.restricted || 0) < exchange.fromAmount) throw new Error('Locked SRA/USD balance is unavailable for reconciliation.');
    const reconciledAt = now();
    if (transfer.state === 'FAILED') {
      const unlocked = {
        ...current,
        available: Number((Number(current.available) + exchange.fromAmount).toFixed(8)),
        restricted: Number((Number(current.restricted) - exchange.fromAmount).toFixed(8)),
        updatedAt: reconciledAt,
      };
      const failed = { ...exchange, state: 'FAILED', confirmation: transfer.confirmation || null, failedAt: reconciledAt, updatedAt: reconciledAt };
      await this.domain.atomicPut([
        { type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: current.positionId, payload: unlocked, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_VALUE_RELEASED' },
        { type: EXCHANGE_TYPE, id: exchange.exchangeId, payload: failed, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_FAILED' },
        { type: QUOTE_TYPE, id: quote.quoteId, payload: { ...quote, state: 'FAILED', exchangeId: exchange.exchangeId, updatedAt: reconciledAt }, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_QUOTE_FAILED' },
      ]);
      return { exchange: failed, transfer, sourcePosition: unlocked, reconciled: true };
    }

    const completedPosition = {
      ...current,
      restricted: Number((Number(current.restricted) - exchange.fromAmount).toFixed(8)),
      total: Number((Number(current.total) - exchange.fromAmount).toFixed(8)),
      updatedAt: reconciledAt,
    };
    const completed = { ...exchange, state: 'COMPLETED', transactionId: transfer.transactionId, confirmation: transfer.confirmation, executedAt: reconciledAt, updatedAt: reconciledAt };
    await this.domain.atomicPut([
      { type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: current.positionId, payload: completedPosition, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_SOURCE_DEBITED' },
      { type: EXCHANGE_TYPE, id: exchange.exchangeId, payload: completed, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_COMPLETED' },
      { type: QUOTE_TYPE, id: quote.quoteId, payload: { ...quote, state: 'CONSUMED', exchangeId: exchange.exchangeId, transactionId: transfer.transactionId, consumedAt: reconciledAt, updatedAt: reconciledAt }, actorId, eventType: 'NATIVE_ASSET_EXCHANGE_QUOTE_CONSUMED' },
    ]);
    await this.directAccounts.recordMovement({
      kind: 'VERIFIED_NATIVE_ASSET_EXCHANGE', directValueAccountId: exchange.directValueAccountId, canonicalAssetId: NATIVE_ASSET_ID,
      network: 'NATIVE', direction: 'DEBIT', amount: exchange.fromAmount, counterAssetId: exchange.toAssetId, counterAmount: exchange.toAmount,
      destinationAddress: exchange.destinationAddress, transactionId: transfer.transactionId, transferId: exchange.transferId, state: 'CONFIRMED',
    }, actorId, 'NATIVE_ASSET_EXCHANGE_COMPLETED');
    return { exchange: completed, transfer, sourcePosition: completedPosition, reconciled: true };
  }
}

export { QUOTE_TYPE as NATIVE_ASSET_EXCHANGE_QUOTE_TYPE };
