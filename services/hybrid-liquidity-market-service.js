import crypto from 'node:crypto';

export const HYBRID_MARKET_DEFINITION = 'SRA_HYBRID_MARKET_DEFINITION';
export const HYBRID_MARKET_REFERENCE = 'SRA_HYBRID_MARKET_REFERENCE';

export const MARKET_MODES = Object.freeze({
  SPOT: 'SPOT',
  CONTINUOUS_REFERENCE: 'CONTINUOUS_REFERENCE',
  EVENT_REFERENCE: 'EVENT_REFERENCE',
  PERPETUAL_REFERENCE: 'PERPETUAL_REFERENCE',
});

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function text(value, field) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${field} is required.`);
  return result;
}
function positive(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${field} must be greater than zero.`);
  return result;
}
function recordTime(record) {
  return String(record?.observedAt || record?.recordedAt || record?.updatedAt || record?.createdAt || '');
}
function participantOrderListing(listing) {
  return Boolean(listing)
    && ['PUBLISHED', 'ACTIVE'].includes(String(listing.state || '').toUpperCase())
    && String(listing.status || '').toUpperCase() === 'LIVE'
    && !listing.executionBlocked
    && (!Array.isArray(listing.blockers) || listing.blockers.length === 0);
}

export class HybridLiquidityMarketService {
  constructor(domain) { this.domain = domain; }

  rawList() {
    return this.domain.list(HYBRID_MARKET_DEFINITION)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  latestReference(marketId) {
    return this.domain.list(HYBRID_MARKET_REFERENCE)
      .filter((item) => item.marketId === marketId)
      .sort((a, b) => recordTime(b).localeCompare(recordTime(a)))[0] || null;
  }

  marketplaceListing(instrumentId) {
    return this.domain.list('MARKETPLACE_LISTING')
      .filter((item) => item.instrumentId === instrumentId)
      .sort((a, b) => String(b.updatedAt || b.publishedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.publishedAt || a.createdAt || '')))
      .find(participantOrderListing) || null;
  }

  marketView(market) {
    if (!market) return null;
    const latestReference = this.latestReference(market.marketId);
    const listing = market.mode === MARKET_MODES.SPOT ? this.marketplaceListing(market.underlyingInstrumentId) : null;
    const participantOrderAvailable = market.mode === MARKET_MODES.SPOT && participantOrderListing(listing);
    return {
      ...market,
      latestReference,
      marketplaceAccess: {
        mode: market.mode === MARKET_MODES.SPOT ? 'GOVERNED_SPOT_HANDOFF' : 'REFERENCE_ONLY',
        participantOrderAvailable,
        listingId: listing?.listingId || null,
        listingState: listing?.state || null,
        listingStatus: listing?.status || null,
        quantity: listing?.quantity ?? null,
        unit: listing?.unit || null,
        askingPrice: listing?.pricing?.askingPrice ?? listing?.unitPrice ?? null,
        quoteCurrency: listing?.pricing?.currency || 'USD',
        pricingAuthority: participantOrderAvailable ? 'MARKETPLACE_LISTING' : null,
        hybridReferenceExecutable: false,
        orderPreviewEndpoint: participantOrderAvailable ? '/api/sane/order-intents/preview' : null,
        orderConfirmEndpoint: participantOrderAvailable ? '/api/sane/order-intents/confirm' : null,
      },
    };
  }

  list() {
    return this.rawList().map((market) => this.marketView(market));
  }

  get(marketId) {
    return this.marketView(this.domain.get(HYBRID_MARKET_DEFINITION, marketId) || null);
  }

  preview(input = {}) {
    const mode = String(input.mode || MARKET_MODES.CONTINUOUS_REFERENCE).toUpperCase();
    if (!Object.values(MARKET_MODES).includes(mode)) throw new Error('Unsupported hybrid market mode.');
    const underlyingInstrumentId = text(input.underlyingInstrumentId, 'underlyingInstrumentId');
    const instrument = this.domain.get('SRA_INSTRUMENT', underlyingInstrumentId);
    if (!instrument) throw new Error('Underlying SRA instrument was not found.');

    const referenceSources = Array.isArray(input.referenceSources) ? input.referenceSources.filter(Boolean) : [];
    const settlement = {
      currency: String(input.settlementCurrency || 'SRA').toUpperCase(),
      cashSettled: input.cashSettled !== false,
      physicalDelivery: false,
    };
    const riskBoundary = {
      executionEnabled: false,
      leverageEnabled: false,
      liquidationEnabled: false,
      fundingPaymentsEnabled: false,
      participantOrdersEnabled: false,
      administratorApprovalRequired: true,
    };

    return {
      readOnly: true,
      marketId: input.marketId || null,
      marketIdentity: input.marketIdentity || `${instrument.denomination?.symbol || 'SRA'} / USD`,
      mode,
      underlyingInstrumentId,
      purpose: mode === MARKET_MODES.SPOT
        ? 'Governed spot participation in a published SRA instrument through the existing Marketplace Engine.'
        : 'Continuous price discovery for a verified SRA instrument without changing the underlying asset record.',
      indexMethodology: {
        method: String(input.indexMethod || 'VERIFIED_REFERENCE_COMPOSITE').toUpperCase(),
        referenceSources,
        minimumSourceCount: Math.max(1, Number(input.minimumSourceCount || 1)),
        staleAfterSeconds: Math.max(30, Number(input.staleAfterSeconds || 300)),
        outlierPolicy: String(input.outlierPolicy || 'MEDIAN_DEVIATION_FILTER').toUpperCase(),
      },
      settlement,
      eventTerms: mode === MARKET_MODES.EVENT_REFERENCE ? {
        question: text(input.eventQuestion, 'eventQuestion'),
        resolutionSource: text(input.resolutionSource, 'resolutionSource'),
        resolutionDeadline: text(input.resolutionDeadline, 'resolutionDeadline'),
      } : null,
      perpetualTerms: mode === MARKET_MODES.PERPETUAL_REFERENCE ? {
        expiry: null,
        markPriceMethod: 'VERIFIED_REFERENCE_INDEX',
        fundingMethod: 'NOT_ENABLED',
      } : null,
      riskBoundary,
      nextState: 'DRAFT_REVIEW',
    };
  }

  async approveDefinition(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator approval is required.');
    const preview = this.preview(input);
    const marketId = input.marketId || id('HLM');
    const approvedAt = now();
    const record = {
      ...preview,
      readOnly: false,
      marketId,
      state: 'APPROVED_REFERENCE_MARKET',
      approvedBy: actorId,
      approvedAt,
      createdAt: approvedAt,
      updatedAt: approvedAt,
      executionState: 'DISABLED',
      statusHistory: [{ state: 'APPROVED_REFERENCE_MARKET', actorId, occurredAt: approvedAt }],
    };
    await this.domain.put(HYBRID_MARKET_DEFINITION, marketId, record, { actorId, eventType: 'HYBRID_MARKET_DEFINITION_APPROVED' });
    return this.marketView(record);
  }

  async recordReference(input = {}, actorId = 'SRA_REFERENCE_ENGINE') {
    const marketId = text(input.marketId, 'marketId');
    const market = this.domain.get(HYBRID_MARKET_DEFINITION, marketId);
    if (!market) throw new Error('Hybrid market definition was not found.');
    const referenceValue = positive(input.referenceValue, 'referenceValue');
    const observedAt = input.observedAt || now();
    const referenceId = id('HMR');
    const record = {
      referenceId,
      marketId,
      underlyingInstrumentId: market.underlyingInstrumentId,
      referenceValue,
      quoteCurrency: String(input.quoteCurrency || 'USD').toUpperCase(),
      sourceCount: Math.max(1, Number(input.sourceCount || 1)),
      methodology: market.indexMethodology.method,
      observedAt,
      recordedAt: now(),
      executablePrice: false,
      settlementInstructionCreated: false,
    };
    await this.domain.put(HYBRID_MARKET_REFERENCE, referenceId, record, { actorId, eventType: 'HYBRID_MARKET_REFERENCE_RECORDED' });
    return record;
  }

  status() {
    const markets = this.rawList();
    const views = markets.map((market) => this.marketView(market));
    const references = this.domain.list(HYBRID_MARKET_REFERENCE);
    return {
      marketCount: markets.length,
      referenceCount: references.length,
      approvedReferenceMarkets: markets.filter((item) => item.state === 'APPROVED_REFERENCE_MARKET').length,
      executionEnabledMarkets: markets.filter((item) => item.executionState === 'ENABLED').length,
      spotOrderAvailableMarkets: views.filter((item) => item.marketplaceAccess?.participantOrderAvailable).length,
      modes: Object.values(MARKET_MODES),
      boundary: 'REFERENCE_AND_GOVERNED_SPOT_HANDOFF',
    };
  }
}
