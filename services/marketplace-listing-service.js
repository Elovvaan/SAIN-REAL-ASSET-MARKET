import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

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
  constructor(persistentDomain) { this.persistentDomain = persistentDomain; }

  list(filters = {}) {
    return this.persistentDomain.list(RECORD_TYPES.MARKETPLACE_LISTING)
      .filter((listing) => !filters.state || listing.state === filters.state)
      .filter((listing) => !filters.instrumentId || listing.instrumentId === filters.instrumentId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  get(listingId) { return this.persistentDomain.get(RECORD_TYPES.MARKETPLACE_LISTING, listingId); }

  async prepareFromInstrument(instrumentId, input = {}, actorId = 'SAIN_AGENT') {
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
      pricing: {
        state: 'NOT_SET',
        method: input.pricingMethod || null,
        askingPrice: input.askingPrice == null ? null : finitePositive(input.askingPrice, 'askingPrice'),
        currency: input.currency || 'USD',
        verifiedValueReference: input.verifiedValueReference || instrument.financialRecordId
      },
      access: {
        state: 'NOT_CONFIGURED',
        eligibilityRule: input.eligibilityRule || null,
        minimumOrder: input.minimumOrder == null ? null : finitePositive(input.minimumOrder, 'minimumOrder'),
        maximumOrder: input.maximumOrder == null ? null : finitePositive(input.maximumOrder, 'maximumOrder')
      },
      readiness: {
        instrumentReviewed: false,
        pricingApproved: false,
        accessRulesApproved: false,
        transactionRouteConnected: false,
        settlementRouteConnected: false
      },
      blockers: [
        'ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED',
        'LISTING_PRICE_REQUIRED',
        'MARKET_ACCESS_RULES_REQUIRED',
        'TRANSACTION_ROUTE_REQUIRED',
        'SETTLEMENT_ROUTE_REQUIRED'
      ],
      sourceLineage: instrument.sourceLineage,
      state: 'PREPARED',
      statusHistory: [{ state: 'PREPARED', actorId, occurredAt: now, reason: input.reason || 'Marketplace listing prepared from draft SRA Instrument.' }],
      phase: 6,
      version: 1,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now
    };

    await this.persistentDomain.put(RECORD_TYPES.MARKETPLACE_LISTING, listingId, listing, { actorId, eventType: 'MARKETPLACE_LISTING_PREPARED' });
    await this.persistentDomain.lifecycle({ objectType: RECORD_TYPES.MARKETPLACE_LISTING, objectId: listingId, eventType: 'INSTRUMENT_MARKETPLACE_LISTING_PREPARED', actorId, payload: { instrumentId, quantity: principalQuantity, unit: listing.unit } });
    return { listing, created: true };
  }

  summary() {
    const listings = this.list();
    const byState = {};
    for (const listing of listings) byState[listing.state] = (byState[listing.state] || 0) + 1;
    return { layer: 'MARKETPLACE_LISTING_LAYER', phase: 6, listingCount: listings.length, byState, latestCreatedAt: listings[0]?.createdAt || null };
  }
}
