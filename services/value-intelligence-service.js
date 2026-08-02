import crypto from 'node:crypto';

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function clean(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function amount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
}

const SIGNAL_TYPES = [
  'QUOTED_PRICE',
  'POTENTIAL_SALE_PRICE',
  'POTENTIAL_RENTAL_INCOME',
  'POTENTIAL_RETURN',
  'POTENTIAL_GAIN',
  'POTENTIAL_LOSS',
  'MARKET_DEMAND',
  'MARKET_ACTIVITY',
  'PARTICIPATION_INTEREST',
  'PROJECTED_COMPLETION_VALUE'
];

const EVENT_TYPES = [
  'SALE_CLOSED',
  'LEASE_EXECUTED',
  'PAYMENT_RECEIVED',
  'REVENUE_RECEIVED',
  'SETTLEMENT_COMPLETED',
  'RENT_COLLECTED'
];

export class ValueIntelligenceService {
  constructor(marketplace) {
    this.marketplace = marketplace;
    this.records = new Map();
    this.signals = new Map();
    this.events = new Map();
    this.seed();
  }

  seed() {
    for (const asset of this.marketplace.assets) {
      const project = this.marketplace.projects.find((item) => item.assetId === asset.id);
      const record = {
        assetId: asset.id,
        verifiedValue: amount(asset.verifiedValue),
        verifiedStatus: asset.state,
        verifiedEvidenceCount: asset.verifiedCycles,
        verifiedActivityCount: asset.lifecycleEvents,
        verifiedRevenue: null,
        verifiedCashFlow: null,
        lastVerifiedAt: new Date().toISOString()
      };
      this.records.set(asset.id, record);
      if (project) {
        const signal = {
          signalId: makeId('MS'),
          assetId: asset.id,
          projectId: project.id,
          signalType: 'PROJECTED_COMPLETION_VALUE',
          amount: amount(project.projectedCompletedValue),
          potentialGain: amount(project.projectedGain),
          potentialGainRate: Number(project.projectedGainRate) || 0,
          status: 'ACTIVE_SIGNAL',
          certainty: 'POTENTIAL',
          source: 'PROJECT_ASSUMPTION',
          createdAt: new Date().toISOString()
        };
        this.signals.set(signal.signalId, signal);
      }
    }
  }

  listAssetState(assetId) {
    const record = this.records.get(assetId);
    if (!record) throw new Error('Verified Value record not found.');
    return {
      verifiedValue: record,
      marketSignals: [...this.signals.values()].filter((item) => item.assetId === assetId),
      verifiedMarketEvents: [...this.events.values()].filter((item) => item.assetId === assetId)
    };
  }

  createSignal(input = {}) {
    const assetId = clean(input.assetId, 80);
    if (!this.records.has(assetId)) throw new Error('Asset not found.');
    const signalType = clean(input.signalType, 80).toUpperCase();
    if (!SIGNAL_TYPES.includes(signalType)) throw new Error('Unsupported market signal type.');
    const signal = {
      signalId: makeId('MS'),
      assetId,
      projectId: clean(input.projectId, 80) || null,
      signalType,
      amount: amount(input.amount),
      potentialGain: amount(input.potentialGain),
      potentialLoss: amount(input.potentialLoss),
      potentialGainRate: Number(input.potentialGainRate) || 0,
      status: 'ACTIVE_SIGNAL',
      certainty: 'POTENTIAL',
      source: clean(input.source, 120) || 'MARKET_INPUT',
      note: clean(input.note, 400) || null,
      createdAt: new Date().toISOString()
    };
    this.signals.set(signal.signalId, signal);
    return signal;
  }

  verifyMarketEvent(input = {}) {
    const signalId = clean(input.signalId, 80);
    const signal = this.signals.get(signalId);
    if (!signal) throw new Error('Market signal not found.');
    if (signal.status !== 'ACTIVE_SIGNAL' && signal.status !== 'ACCEPTED_SIGNAL') throw new Error('Signal is not eligible to graduate.');
    const eventType = clean(input.eventType, 80).toUpperCase();
    if (!EVENT_TYPES.includes(eventType)) throw new Error('Unsupported verified market event type.');
    const realizedAmount = amount(input.realizedAmount);
    if (!realizedAmount) throw new Error('A realized amount is required.');
    const now = new Date().toISOString();
    const record = this.records.get(signal.assetId);
    const verifiedGain = amount(Math.max(realizedAmount - record.verifiedValue, 0));
    const verifiedLoss = amount(Math.max(record.verifiedValue - realizedAmount, 0));
    const event = {
      eventId: makeId('VME'),
      signalId,
      assetId: signal.assetId,
      projectId: signal.projectId,
      eventType,
      realizedAmount,
      verifiedMarketPrice: realizedAmount,
      verifiedGain,
      verifiedLoss,
      evidenceReference: clean(input.evidenceReference, 160) || null,
      status: 'VERIFIED_EVENT',
      occurredAt: clean(input.occurredAt, 64) || now,
      verifiedAt: now
    };
    signal.status = 'GRADUATED_TO_VERIFIED_EVENT';
    signal.graduatedEventId = event.eventId;
    signal.updatedAt = now;
    this.events.set(event.eventId, event);
    record.verifiedValue = realizedAmount;
    record.lastVerifiedAt = now;
    record.lastMarketEventId = event.eventId;
    return { event, verifiedValueRecord: record };
  }

  summary() {
    return {
      architectureVersion: 'V17',
      principle: 'When you hit the ground, you hit Sane.',
      layers: {
        verifiedValue: 'What is supported as true now.',
        marketIntelligence: 'What the market indicates may happen.',
        verifiedMarketEvents: 'What actually happened and became evidence.'
      },
      counts: {
        verifiedValueRecords: this.records.size,
        activeSignals: [...this.signals.values()].filter((item) => item.status === 'ACTIVE_SIGNAL').length,
        verifiedMarketEvents: this.events.size
      }
    };
  }
}

export { SIGNAL_TYPES, EVENT_TYPES };
