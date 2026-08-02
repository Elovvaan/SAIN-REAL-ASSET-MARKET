import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

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
  'QUOTED_PRICE','POTENTIAL_SALE_PRICE','POTENTIAL_RENTAL_INCOME','POTENTIAL_RETURN',
  'POTENTIAL_GAIN','POTENTIAL_LOSS','MARKET_DEMAND','MARKET_ACTIVITY',
  'PARTICIPATION_INTEREST','PROJECTED_COMPLETION_VALUE'
];

const EVENT_TYPES = [
  'SALE_CLOSED','LEASE_EXECUTED','PAYMENT_RECEIVED','REVENUE_RECEIVED',
  'SETTLEMENT_COMPLETED','RENT_COLLECTED'
];

export class ValueIntelligenceService {
  constructor(marketplace, domain) {
    this.marketplace = marketplace;
    this.domain = domain;
  }

  async initialize() {
    const records = this.marketplace.assets.map((asset) => ({
      assetId: asset.id,
      verifiedValue: amount(asset.verifiedValue),
      verifiedStatus: asset.state,
      verifiedEvidenceCount: asset.verifiedCycles,
      verifiedActivityCount: asset.lifecycleEvents,
      verifiedRevenue: null,
      verifiedCashFlow: null,
      lastVerifiedAt: new Date().toISOString()
    }));
    await this.domain.seed(RECORD_TYPES.VERIFIED_VALUE_RECORD, records);

    if (!this.domain.list(RECORD_TYPES.MARKET_SIGNAL).length) {
      for (const asset of this.marketplace.assets) {
        const project = this.marketplace.projects.find((item) => item.assetId === asset.id);
        if (!project) continue;
        const signal = {
          signalId: makeId('MS'), assetId: asset.id, projectId: project.id,
          signalType: 'PROJECTED_COMPLETION_VALUE', amount: amount(project.projectedCompletedValue),
          potentialGain: amount(project.projectedGain), potentialGainRate: Number(project.projectedGainRate) || 0,
          status: 'ACTIVE_SIGNAL', certainty: 'POTENTIAL', source: 'PROJECT_ASSUMPTION',
          createdAt: new Date().toISOString()
        };
        await this.domain.put(RECORD_TYPES.MARKET_SIGNAL, signal.signalId, signal, { audit: false });
      }
    }
  }

  listAssetState(assetId) {
    const record = this.domain.get(RECORD_TYPES.VERIFIED_VALUE_RECORD, assetId);
    if (!record) throw new Error('Verified Value record not found.');
    return {
      verifiedValue: record,
      marketSignals: this.domain.list(RECORD_TYPES.MARKET_SIGNAL).filter((item) => item.assetId === assetId),
      verifiedMarketEvents: this.domain.list(RECORD_TYPES.VERIFIED_MARKET_EVENT).filter((item) => item.assetId === assetId)
    };
  }

  async createSignal(input = {}, actorId = null) {
    const assetId = clean(input.assetId, 80);
    if (!this.domain.get(RECORD_TYPES.VERIFIED_VALUE_RECORD, assetId)) throw new Error('Asset not found.');
    const signalType = clean(input.signalType, 80).toUpperCase();
    if (!SIGNAL_TYPES.includes(signalType)) throw new Error('Unsupported market signal type.');
    const signal = {
      signalId: makeId('MS'), assetId,
      projectId: clean(input.projectId, 80) || null, signalType,
      amount: amount(input.amount), potentialGain: amount(input.potentialGain),
      potentialLoss: amount(input.potentialLoss), potentialGainRate: Number(input.potentialGainRate) || 0,
      status: 'ACTIVE_SIGNAL', certainty: 'POTENTIAL', source: clean(input.source, 120) || 'MARKET_INPUT',
      note: clean(input.note, 400) || null, createdAt: new Date().toISOString()
    };
    await this.domain.put(RECORD_TYPES.MARKET_SIGNAL, signal.signalId, signal, { actorId, eventType: 'MARKET_SIGNAL_CREATED' });
    return signal;
  }

  async verifyMarketEvent(input = {}, actorId = null) {
    const signalId = clean(input.signalId, 80);
    const signal = this.domain.get(RECORD_TYPES.MARKET_SIGNAL, signalId);
    if (!signal) throw new Error('Market signal not found.');
    if (!['ACTIVE_SIGNAL','ACCEPTED_SIGNAL'].includes(signal.status)) throw new Error('Signal is not eligible to graduate.');
    const eventType = clean(input.eventType, 80).toUpperCase();
    if (!EVENT_TYPES.includes(eventType)) throw new Error('Unsupported verified market event type.');
    const realizedAmount = amount(input.realizedAmount);
    if (!realizedAmount) throw new Error('A realized amount is required.');
    const now = new Date().toISOString();
    const record = this.domain.get(RECORD_TYPES.VERIFIED_VALUE_RECORD, signal.assetId);
    const event = {
      eventId: makeId('VME'), signalId, assetId: signal.assetId, projectId: signal.projectId,
      eventType, realizedAmount, verifiedMarketPrice: realizedAmount,
      verifiedGain: amount(Math.max(realizedAmount - record.verifiedValue, 0)),
      verifiedLoss: amount(Math.max(record.verifiedValue - realizedAmount, 0)),
      evidenceReference: clean(input.evidenceReference, 160) || null,
      status: 'VERIFIED_EVENT', occurredAt: clean(input.occurredAt, 64) || now, verifiedAt: now
    };
    signal.status = 'GRADUATED_TO_VERIFIED_EVENT';
    signal.graduatedEventId = event.eventId;
    signal.updatedAt = now;
    record.verifiedValue = realizedAmount;
    record.lastVerifiedAt = now;
    record.lastMarketEventId = event.eventId;

    await this.domain.put(RECORD_TYPES.MARKET_SIGNAL, signal.signalId, signal, { actorId, eventType: 'MARKET_SIGNAL_GRADUATED' });
    await this.domain.put(RECORD_TYPES.VERIFIED_MARKET_EVENT, event.eventId, event, { actorId, eventType: 'VERIFIED_MARKET_EVENT_RECORDED' });
    await this.domain.put(RECORD_TYPES.VERIFIED_VALUE_RECORD, record.assetId, record, { actorId, eventType: 'VERIFIED_VALUE_UPDATED' });
    await this.domain.lifecycle({actorId,objectType:RECORD_TYPES.VERIFIED_VALUE_RECORD,objectId:record.assetId,eventType:'MARKET_EVENT_ADMITTED_TO_VERIFIED_VALUE',payload:{signalId,eventId:event.eventId,realizedAmount}});
    return { event, verifiedValueRecord: record };
  }

  summary() {
    const records = this.domain.list(RECORD_TYPES.VERIFIED_VALUE_RECORD);
    const signals = this.domain.list(RECORD_TYPES.MARKET_SIGNAL);
    const events = this.domain.list(RECORD_TYPES.VERIFIED_MARKET_EVENT);
    return {
      architectureVersion: 'V17', principle: 'When you hit the ground, you hit Sane.',
      layers: {
        verifiedValue: 'What is supported as true now.',
        marketIntelligence: 'What the market indicates may happen.',
        verifiedMarketEvents: 'What actually happened and became evidence.'
      },
      counts: {
        verifiedValueRecords: records.length,
        activeSignals: signals.filter((item) => item.status === 'ACTIVE_SIGNAL').length,
        verifiedMarketEvents: events.length
      }
    };
  }
}

export { SIGNAL_TYPES, EVENT_TYPES };
