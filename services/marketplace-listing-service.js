import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const LISTING_RECORD_TYPE = 'MARKETPLACE_LISTING';
const SRA_PAR_UNIT_PRICE_USD = 1;
const SRA_PAR_PRICING_METHOD = 'VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR';
const INVALID_FINANCIAL_RECORD_BLOCKER = 'INVALID_LINKED_FINANCIAL_RECORD';

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}

function deterministicListingId(instrumentId) {
  const digest = crypto.createHash('sha256').update(String(instrumentId)).digest('hex').slice(0, 16).toUpperCase();
  return `ML-${digest}`;
}

function lifecycleRank(listing) {
  if (listing?.status === 'LIVE' || ['PUBLISHED', 'ACTIVE'].includes(listing?.state)) return 3;
  if (listing?.status === 'READY_FOR_PUBLICATION_APPROVAL') return 2;
  if (listing?.state === 'PREPARED') return 1;
  return 0;
}

function recordTime(listing) {
  return String(listing?.updatedAt || listing?.publishedAt || listing?.createdAt || '');
}

function preferredListing(current, candidate) {
  if (!current) return candidate;
  const rankDifference = lifecycleRank(candidate) - lifecycleRank(current);
  if (rankDifference > 0) return candidate;
  if (rankDifference < 0) return current;
  return recordTime(candidate).localeCompare(recordTime(current)) > 0 ? candidate : current;
}

function listingRecordedValueUsd(listing, linkedFinancialRecordAmount = null) {
  const candidates = [
    linkedFinancialRecordAmount,
    listing?.verifiedRecordedValueUsd,
    listing?.recordedValueUsd,
    listing?.faceValueUsd,
    listing?.pricing?.recordedValueUsd,
    listing?.pricing?.faceValueUsd,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }

  // Deliberate compatibility rule for historical LIVE SRA listings created
  // before Financial Record lineage and explicit recorded-value fields existed.
  if (!listing?.financialRecordId && (listing?.status === 'LIVE' || ['PUBLISHED', 'ACTIVE'].includes(listing?.state))) {
    const legacyQuantity = Number(listing?.quantity ?? listing?.offeredQuantity ?? 0);
    if (Number.isFinite(legacyQuantity) && legacyQuantity > 0) return legacyQuantity;
  }
  return 0;
}

function withCanonicalSraPricing(listing, linkedFinancialRecordAmount = null) {
  if (!listing) return listing;
  const unit = String(listing.unit || listing.marketIdentity?.base || '').toUpperCase();
  const recordedValueUsd = listingRecordedValueUsd(listing, linkedFinancialRecordAmount);
  if (unit !== 'SRA' || recordedValueUsd <= 0) return listing;
  const blockers = Array.isArray(listing.blockers)
    ? listing.blockers.filter((blocker) => blocker !== 'LISTING_PRICE_REQUIRED')
    : [];
  return {
    ...listing,
    quantity: recordedValueUsd,
    verifiedRecordedValueUsd: recordedValueUsd,
    recordedValueUsd,
    faceValueUsd: recordedValueUsd,
    pricing: {
      ...(listing.pricing || {}),
      state: 'CONFIGURED',
      method: SRA_PAR_PRICING_METHOD,
      askingPrice: SRA_PAR_UNIT_PRICE_USD,
      unitPrice: SRA_PAR_UNIT_PRICE_USD,
      currency: 'USD',
      faceValueUsd: recordedValueUsd,
      recordedValueUsd,
      parReference: '1 SRA = 1 USD'
    },
    readiness: { ...(listing.readiness || {}), pricingApproved: true },
    blockers
  };
}

function canonicalByInstrument(records) {
  const canonical = new Map();
  const grouped = new Map();
  for (const listing of records) {
    const key = listing.instrumentId || listing.listingId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(listing);
    canonical.set(key, preferredListing(canonical.get(key), listing));
  }
  const selected = new Set([...canonical.values()]);
  const duplicates = [...grouped.values()].flat().filter((listing) => !selected.has(listing));
  return {
    listings: [...canonical.values()].sort((a, b) => recordTime(b).localeCompare(recordTime(a))),
    duplicates,
  };
}

function stateBucket(listing) {
  if (listing?.status === 'LIVE' || ['PUBLISHED', 'ACTIVE'].includes(listing?.state)) return 'LIVE';
  if (listing?.status === 'READY_FOR_PUBLICATION_APPROVAL') return 'READY';
  return 'PREPARED';
}

export class MarketplaceListingService {
  constructor(persistentDomain, options = {}) {
    this.persistentDomain = persistentDomain;
    this.environment = options.environment || process.env;
    this.enabled = String(this.environment.MARKETPLACE_LISTING_PREPARATION_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.backfillLimit = Number(this.environment.MARKETPLACE_LISTING_BACKFILL_LIMIT ?? 5000);
    this.cycleIntervalMs = Math.max(5000, Number(this.environment.MARKETPLACE_LISTING_CYCLE_INTERVAL_MS ?? 15000));
    this.autoStart = String(options.autoStart ?? this.environment.MARKETPLACE_LISTING_AUTO_START ?? 'true').toLowerCase() !== 'false';
    this.prepared = 0;
    this.failed = 0;
    this.backfillState = 'NOT_STARTED';
    this.cycleState = this.autoStart && this.enabled ? 'STARTING' : 'STOPPED';
    this.lastPreparedAt = null;
    this.lastCycleAt = null;
    this.lastError = null;
    this.timer = null;
    if (this.autoStart && this.enabled) queueMicrotask(() => { void this.startPreparationCycle(); });
  }

  linkedRecordedValueUsd(listingOrInstrument, options = {}) {
    const financialRecordId = String(listingOrInstrument?.financialRecordId || '').trim();
    if (!financialRecordId) {
      if (options.required) throw new Error('Instrument must reference a Financial Record before marketplace preparation.');
      return 0;
    }
    const record = this.persistentDomain.get(RECORD_TYPES.FINANCIAL_RECORD, financialRecordId);
    if (!record) throw new Error(`Linked Financial Record ${financialRecordId} was not found.`);
    const unit = String(record.recognizedPosition?.unit || record.measurement?.unit || '').toUpperCase();
    if (unit !== 'USD') throw new Error(`Financial record ${financialRecordId} is not denominated in USD.`);
    return finitePositive(record.recognizedPosition?.amount ?? record.measurement?.value, `financial record ${financialRecordId} recorded USD amount`);
  }

  canonicalize(listing) {
    try {
      return withCanonicalSraPricing(listing, this.linkedRecordedValueUsd(listing));
    } catch (error) {
      const blockers = new Set(Array.isArray(listing?.blockers) ? listing.blockers : []);
      blockers.add(INVALID_FINANCIAL_RECORD_BLOCKER);
      return {
        ...listing,
        blockers: [...blockers],
        executionBlocked: true,
        canonicalization: {
          state: 'INVALID_LINKED_FINANCIAL_RECORD',
          message: error?.message || String(error)
        }
      };
    }
  }

  rawList() {
    return this.persistentDomain.list(LISTING_RECORD_TYPE).map((listing) => this.canonicalize(listing));
  }

  list(filters = {}) {
    const { listings } = canonicalByInstrument(this.rawList());
    return listings
      .filter((listing) => !filters.state || listing.state === filters.state || stateBucket(listing) === filters.state)
      .filter((listing) => !filters.instrumentId || listing.instrumentId === filters.instrumentId);
  }

  page(filters = {}, options = {}) {
    const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(options.limit, 10) || 25));
    const listings = this.list(filters);
    const total = listings.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const counts = listings.reduce((result, listing) => {
      result[stateBucket(listing)] += 1;
      return result;
    }, { LIVE: 0, READY: 0, PREPARED: 0 });
    return { listings: listings.slice(start, start + limit), total, counts, page, limit, totalPages };
  }

  get(listingId) {
    const direct = this.persistentDomain.get(LISTING_RECORD_TYPE, listingId);
    if (direct) return this.canonicalize(direct);
    return this.list().find((listing) => listing.listingId === listingId) || null;
  }

  async prepareFromInstrument(instrumentId, input = {}, actorId = 'SAIN_MARKETPLACE_LISTING_ENGINE') {
    if (!this.enabled) return { listing: null, created: false, reason: 'LISTING_PREPARATION_DISABLED' };
    const instrument = this.persistentDomain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error('Instrument not found.');
    if (!['DRAFT', 'RECORDED', 'ACTIVE', 'RESTRICTED'].includes(instrument.state)) throw new Error('Instrument is not available for listing preparation.');

    const listingId = deterministicListingId(instrumentId);
    const deterministic = this.persistentDomain.get(LISTING_RECORD_TYPE, listingId);
    if (deterministic && !['CANCELLED', 'CLOSED'].includes(deterministic.state)) return { listing: this.canonicalize(deterministic), created: false };
    const existing = this.list({ instrumentId }).find((listing) => !['CANCELLED', 'CLOSED'].includes(listing.state));
    if (existing) return { listing: existing, created: false };

    // Required validation occurs before any listing write. Missing, dangling,
    // non-USD, or non-positive Financial Records leave the instrument pending.
    const recordedValueUsd = this.linkedRecordedValueUsd(instrument, { required: true });
    const representedSraQuantity = finitePositive(instrument.denomination?.principalQuantity, 'instrument principal quantity');
    const now = new Date().toISOString();
    const listing = {
      listingId,
      instrumentId,
      coinPositionId: instrument.coinPositionId,
      financialRecordId: instrument.financialRecordId,
      recognitionId: instrument.recognitionId,
      observationId: instrument.observationId,
      listingType: requireText(input.listingType || 'SRA_INSTRUMENT_OFFERING', 'listingType').toUpperCase(),
      title: input.title || instrument.name,
      seller: input.seller || instrument.issuer,
      quantity: recordedValueUsd,
      representedSraQuantity,
      verifiedRecordedValueUsd: recordedValueUsd,
      recordedValueUsd,
      faceValueUsd: recordedValueUsd,
      unit: instrument.denomination?.symbol || 'SRA',
      pricing: {
        state: 'CONFIGURED', method: SRA_PAR_PRICING_METHOD,
        askingPrice: 1, unitPrice: 1, currency: 'USD',
        faceValueUsd: recordedValueUsd, recordedValueUsd,
        parReference: '1 SRA = 1 USD', verifiedValueReference: instrument.financialRecordId
      },
      access: { state: 'NOT_CONFIGURED', eligibilityRule: null, minimumOrder: null, maximumOrder: null },
      readiness: { instrumentReviewed: false, pricingApproved: true, accessRulesApproved: false, transactionRouteConnected: false, settlementRouteConnected: false },
      blockers: ['ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED', 'MARKET_ACCESS_RULES_REQUIRED', 'TRANSACTION_ROUTE_REQUIRED', 'SETTLEMENT_ROUTE_REQUIRED'],
      sourceLineage: instrument.sourceLineage,
      state: 'PREPARED',
      statusHistory: [{ state: 'PREPARED', actorId, occurredAt: now, reason: 'Marketplace listing prepared from the linked Financial Record recorded USD amount at the fixed SRA/USD par reference.' }],
      phase: 6,
      version: 4,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now
    };

    await this.persistentDomain.put(LISTING_RECORD_TYPE, listingId, listing, { actorId, eventType: 'MARKETPLACE_LISTING_PREPARED' });
    await this.persistentDomain.lifecycle({ objectType: LISTING_RECORD_TYPE, objectId: listingId, eventType: 'INSTRUMENT_MARKETPLACE_LISTING_PREPARED', actorId, payload: { instrumentId, representedSraQuantity, recordedValueUsd, unit: listing.unit, unitPriceUsd: 1, faceValueUsd: recordedValueUsd } });
    this.prepared += 1;
    this.lastPreparedAt = now;
    return { listing, created: true };
  }

  pendingInstruments() {
    const listedInstrumentIds = new Set(this.list().map((listing) => listing.instrumentId));
    return this.persistentDomain.list(RECORD_TYPES.SRA_INSTRUMENT)
      .filter((instrument) => ['DRAFT', 'RECORDED', 'ACTIVE', 'RESTRICTED'].includes(instrument.state))
      .filter((instrument) => !listedInstrumentIds.has(instrument.instrumentId));
  }

  async backfill() {
    if (!this.enabled || this.backfillState === 'RUNNING') return this.status();
    this.backfillState = 'RUNNING';
    this.lastCycleAt = new Date().toISOString();
    const instruments = this.pendingInstruments().slice(0, Number.isFinite(this.backfillLimit) && this.backfillLimit > 0 ? this.backfillLimit : 5000);
    for (const instrument of instruments) {
      try { await this.prepareFromInstrument(instrument.instrumentId); }
      catch (error) {
        this.failed += 1;
        this.lastError = { instrumentId: instrument.instrumentId, message: error?.message || String(error), at: new Date().toISOString() };
      }
    }
    this.backfillState = 'COMPLETED';
    return this.status();
  }

  async startPreparationCycle() {
    if (!this.enabled) { this.cycleState = 'DISABLED'; return this.status(); }
    if (this.timer) return this.status();
    this.cycleState = 'RUNNING';
    await this.backfill();
    this.timer = setInterval(() => { void this.backfill(); }, this.cycleIntervalMs);
    this.timer.unref?.();
    return this.status();
  }

  stopPreparationCycle() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cycleState = 'STOPPED';
    return this.status();
  }

  status() {
    return {
      enabled: this.enabled,
      state: this.enabled ? 'ACTIVE' : 'DISABLED',
      prepared: this.prepared,
      failed: this.failed,
      backfillState: this.backfillState,
      cycleState: this.cycleState,
      cycleIntervalMs: this.cycleIntervalMs,
      pendingInstrumentCount: this.pendingInstruments().length,
      lastPreparedAt: this.lastPreparedAt,
      lastCycleAt: this.lastCycleAt,
      lastError: this.lastError,
      ...this.summary()
    };
  }

  summary() {
    const raw = this.rawList();
    const { listings, duplicates } = canonicalByInstrument(raw);
    const byState = {};
    const counts = { LIVE: 0, READY: 0, PREPARED: 0 };
    let invalidListingCount = 0;
    for (const listing of listings) {
      byState[listing.state] = (byState[listing.state] || 0) + 1;
      counts[stateBucket(listing)] += 1;
      if (listing.canonicalization?.state === 'INVALID_LINKED_FINANCIAL_RECORD') invalidListingCount += 1;
    }
    return { layer: 'MARKETPLACE_LISTING_LAYER', phase: 6, listingCount: listings.length, invalidListingCount, storedRecordCount: raw.length, supersededDuplicateCount: duplicates.length, byState, counts, latestCreatedAt: listings[0]?.createdAt || null };
  }
}

export {
  LISTING_RECORD_TYPE,
  SRA_PAR_UNIT_PRICE_USD,
  SRA_PAR_PRICING_METHOD,
  INVALID_FINANCIAL_RECORD_BLOCKER,
  deterministicListingId,
  canonicalByInstrument,
  withCanonicalSraPricing
};
