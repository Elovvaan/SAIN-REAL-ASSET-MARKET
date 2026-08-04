import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const LISTING_RECORD_TYPE = 'MARKETPLACE_LISTING';

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

export class MarketplaceListingService {
  constructor(persistentDomain, options = {}) {
    this.persistentDomain = persistentDomain;
    this.enabled = String(options.environment?.MARKETPLACE_LISTING_PREPARATION_ENABLED ?? process.env.MARKETPLACE_LISTING_PREPARATION_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.backfillLimit = Number(options.environment?.MARKETPLACE_LISTING_BACKFILL_LIMIT ?? process.env.MARKETPLACE_LISTING_BACKFILL_LIMIT ?? 5000);
    this.prepared = 0;
    this.failed = 0;
    this.backfillState = 'NOT_STARTED';
    this.lastPreparedAt = null;
    this.lastError = null;
  }

  list(filters = {}) {
    return this.persistentDomain.list(LISTING_RECORD_TYPE)
      .filter((listing) => !filters.state || listing.state === filters.state)
      .filter((listing) => !filters.instrumentId || listing.instrumentId === filters.instrumentId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  get(listingId) { return this.persistentDomain.get(LISTING_RECORD_TYPE, listingId); }

  async prepareFromInstrument(instrumentId, input = {}, actorId = 'SAIN_MARKETPLACE_LISTING_ENGINE') {
    if (!this.enabled) return { listing: null, created: false, reason: 'LISTING_PREPARATION_DISABLED' };
    const instrument = this.persistentDomain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error('Instrument not found.');
    if (!['DRAFT', 'RECORDED', 'ACTIVE', 'RESTRICTED'].includes(instrument.state)) throw new Error('Instrument is not available for listing preparation.');

    const existing = this.list({ instrumentId }).find((listing) => !['CANCELLED', 'CLOSED'].includes(listing.state));
    if (existing) return { listing: existing, created: false };

    const principalQuantity = finitePositive(instrument.denomination?.principalQuantity, 'instrument principal quantity');
    const listingId = `ML-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
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
      quantity: principalQuantity,
      unit: instrument.denomination?.symbol || 'SRA',
      pricing: { state: 'NOT_SET', method: null, askingPrice: null, currency: 'USD', verifiedValueReference: instrument.financialRecordId },
      access: { state: 'NOT_CONFIGURED', eligibilityRule: null, minimumOrder: null, maximumOrder: null },
      readiness: { instrumentReviewed: false, pricingApproved: false, accessRulesApproved: false, transactionRouteConnected: false, settlementRouteConnected: false },
      blockers: ['ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED', 'LISTING_PRICE_REQUIRED', 'MARKET_ACCESS_RULES_REQUIRED', 'TRANSACTION_ROUTE_REQUIRED', 'SETTLEMENT_ROUTE_REQUIRED'],
      sourceLineage: instrument.sourceLineage,
      state: 'PREPARED',
      statusHistory: [{ state: 'PREPARED', actorId, occurredAt: now, reason: 'Marketplace listing prepared from SRA Instrument.' }],
      phase: 6,
      version: 1,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now
    };

    await this.persistentDomain.put(LISTING_RECORD_TYPE, listingId, listing, { actorId, eventType: 'MARKETPLACE_LISTING_PREPARED' });
    await this.persistentDomain.lifecycle({ objectType: LISTING_RECORD_TYPE, objectId: listingId, eventType: 'INSTRUMENT_MARKETPLACE_LISTING_PREPARED', actorId, payload: { instrumentId, quantity: principalQuantity, unit: listing.unit } });
    this.prepared += 1;
    this.lastPreparedAt = now;
    return { listing, created: true };
  }

  async backfill() {
    if (!this.enabled || this.backfillState === 'RUNNING') return this.status();
    this.backfillState = 'RUNNING';
    const instruments = this.persistentDomain.list(RECORD_TYPES.SRA_INSTRUMENT)
      .filter((instrument) => ['DRAFT', 'RECORDED', 'ACTIVE', 'RESTRICTED'].includes(instrument.state))
      .slice(0, Number.isFinite(this.backfillLimit) && this.backfillLimit > 0 ? this.backfillLimit : 5000);
    for (const instrument of instruments) {
      try { await this.prepareFromInstrument(instrument.instrumentId); }
      catch (error) { this.failed += 1; this.lastError = { instrumentId: instrument.instrumentId, message: error?.message || String(error), at: new Date().toISOString() }; }
    }
    this.backfillState = 'COMPLETED';
    return this.status();
  }

  status() {
    return { enabled: this.enabled, state: this.enabled ? 'ACTIVE' : 'DISABLED', prepared: this.prepared, failed: this.failed, backfillState: this.backfillState, lastPreparedAt: this.lastPreparedAt, lastError: this.lastError, ...this.summary() };
  }

  summary() {
    const listings = this.list();
    const byState = {};
    for (const listing of listings) byState[listing.state] = (byState[listing.state] || 0) + 1;
    return { layer: 'MARKETPLACE_LISTING_LAYER', phase: 6, listingCount: listings.length, byState, latestCreatedAt: listings[0]?.createdAt || null };
  }
}
