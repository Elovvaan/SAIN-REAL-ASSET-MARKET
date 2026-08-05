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

export class HybridLiquidityMarketService {
  constructor(domain) { this.domain = domain; }

  list() {
    return this.domain.list(HYBRID_MARKET_DEFINITION)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  get(marketId) {
    return this.domain.get(HYBRID_MARKET_DEFINITION, marketId) || null;
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
      purpose: 'Continuous price discovery for a verified SRA instrument without changing the underlying asset record.',
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
    return record;
  }

  async recordReference(input = {}, actorId = 'SRA_REFERENCE_ENGINE') {
    const marketId = text(input.marketId, 'marketId');
    const market = this.get(marketId);
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
    const markets = this.list();
    const references = this.domain.list(HYBRID_MARKET_REFERENCE);
    return {
      marketCount: markets.length,
      referenceCount: references.length,
      approvedReferenceMarkets: markets.filter((item) => item.state === 'APPROVED_REFERENCE_MARKET').length,
      executionEnabledMarkets: markets.filter((item) => item.executionState === 'ENABLED').length,
      modes: Object.values(MARKET_MODES),
      boundary: 'REFERENCE_AND_PRICE_DISCOVERY_ONLY',
    };
  }
}
