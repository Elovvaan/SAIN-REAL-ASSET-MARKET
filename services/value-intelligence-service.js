import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { DeterminationEngineService, DETERMINATION_RECORD_TYPES } from './determination-engine-service.js';

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

const VERIFIED_EVENT_METHOD_VERSION = 'SRA-VERIFIED-MARKET-EVENT-DIRECT-1.0';
const VERIFIED_EVENT_PERMITTED_USES = Object.freeze(['INTERNAL_ANALYSIS', 'CONTRACT_REFERENCE']);

export class ValueIntelligenceService {
  constructor(marketplace, domain) {
    this.marketplace = marketplace;
    this.domain = domain;
    this.determinationEngine = new DeterminationEngineService(domain);
  }

  async initialize() {
    await this.determinationEngine.initialize();
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
    const canonicalVerifiedValueRecord = record.canonicalVerifiedValueRecordId
      ? this.domain.get(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, record.canonicalVerifiedValueRecordId)
      : null;
    return {
      verifiedValue: record,
      canonicalVerifiedValueRecord,
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

  async createCanonicalMarketEventDetermination({ signal, event, realizedAmount, currency }, actorId = null) {
    const subjectId = `MARKET-EVENT-ASSET-${signal.assetId}`;
    let subject = this.domain.get(DETERMINATION_RECORD_TYPES.SUBJECT, subjectId);
    if (!subject) {
      subject = await this.determinationEngine.registerSubject({
        subjectId,
        subjectType: 'ASSET_MARKET_EVENT_STATE',
        label: `Verified market state for ${signal.assetId}`,
        externalReference: signal.assetId,
        identity: { assetId: signal.assetId, projectId: signal.projectId || null },
        provenance: { system: 'SRA', sourceProcess: 'VERIFIED_MARKET_EVENT' },
        permittedUses: VERIFIED_EVENT_PERMITTED_USES,
      }, actorId);
    }

    const observation = await this.determinationEngine.recordObservation({
      subjectId,
      sourceId: `VERIFIED_MARKET_EVENT:${event.eventId}`,
      sourceType: 'SRA_VERIFIED_MARKET_EVENT',
      value: realizedAmount,
      currency,
      observedAt: event.occurredAt,
      evidenceReference: event.evidenceReference,
      permission: 'CONTRACT_REFERENCE',
      quality: { state: event.status, eventType: event.eventType },
      metadata: { signalId: signal.signalId, eventId: event.eventId, assetId: signal.assetId, projectId: signal.projectId || null },
    }, actorId);

    const snapshot = await this.determinationEngine.createSnapshot({
      subjectId,
      observationIds: [observation.observationId],
      observationStart: event.occurredAt,
      observationEnd: event.occurredAt,
      methodologyVersion: VERIFIED_EVENT_METHOD_VERSION,
      permittedUses: VERIFIED_EVENT_PERMITTED_USES,
    }, actorId);

    const canonical = await this.determinationEngine.determine({
      snapshotId: snapshot.snapshotId,
      methodology: 'DIRECT',
      methodologyVersion: VERIFIED_EVENT_METHOD_VERSION,
      directValue: realizedAmount,
      currency,
      confidence: {
        level: 'DIRECT_VERIFIED_EVENT',
        basis: 'SRA_VERIFIED_MARKET_EVENT',
        sourceCount: 1,
        observationCount: 1,
      },
    }, actorId);

    return { subject, observation, snapshot, ...canonical };
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

    const currency = clean(input.currency, 16).toUpperCase() || 'USD';
    const canonical = await this.createCanonicalMarketEventDetermination({ signal, event, realizedAmount, currency }, actorId);

    signal.status = 'GRADUATED_TO_VERIFIED_EVENT';
    signal.graduatedEventId = event.eventId;
    signal.updatedAt = now;
    event.determinationSubjectId = canonical.subject.subjectId;
    event.observationId = canonical.observation.observationId;
    event.snapshotId = canonical.snapshot.snapshotId;
    event.determinationId = canonical.determination.determinationId;
    event.canonicalVerifiedValueRecordId = canonical.verifiedValueRecord.verifiedValueRecordId;
    record.verifiedValue = realizedAmount;
    record.lastVerifiedAt = now;
    record.lastMarketEventId = event.eventId;
    record.determinationSubjectId = canonical.subject.subjectId;
    record.latestSnapshotId = canonical.snapshot.snapshotId;
    record.latestDeterminationId = canonical.determination.determinationId;
    record.canonicalVerifiedValueRecordId = canonical.verifiedValueRecord.verifiedValueRecordId;
    record.canonicalValueArchitecture = 'REFERENCE_TO_IMMUTABLE_VVR';

    await this.domain.atomicPut([
      { type: RECORD_TYPES.MARKET_SIGNAL, id: signal.signalId, payload: signal, actorId, eventType: 'MARKET_SIGNAL_GRADUATED' },
      { type: RECORD_TYPES.VERIFIED_MARKET_EVENT, id: event.eventId, payload: event, actorId, eventType: 'VERIFIED_MARKET_EVENT_RECORDED' },
      { type: RECORD_TYPES.VERIFIED_VALUE_RECORD, id: record.assetId, payload: record, actorId, eventType: 'VERIFIED_VALUE_UPDATED' },
    ]);
    await this.domain.lifecycle({
      actorId,
      objectType: RECORD_TYPES.VERIFIED_VALUE_RECORD,
      objectId: record.assetId,
      eventType: 'MARKET_EVENT_ADMITTED_TO_VERIFIED_VALUE',
      payload: {
        signalId,
        eventId: event.eventId,
        realizedAmount,
        snapshotId: canonical.snapshot.snapshotId,
        determinationId: canonical.determination.determinationId,
        canonicalVerifiedValueRecordId: canonical.verifiedValueRecord.verifiedValueRecordId,
      },
    });
    return { event, verifiedValueRecord: record, canonicalVerifiedValueRecord: canonical.verifiedValueRecord };
  }

  summary() {
    const records = this.domain.list(RECORD_TYPES.VERIFIED_VALUE_RECORD);
    const signals = this.domain.list(RECORD_TYPES.MARKET_SIGNAL);
    const events = this.domain.list(RECORD_TYPES.VERIFIED_MARKET_EVENT);
    const canonicalRecords = this.domain.list(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE);
    return {
      architectureVersion: 'V18', principle: 'When you hit the ground, you hit Sane.',
      layers: {
        verifiedValue: 'Legacy current-state projection with canonical VVR references.',
        canonicalVerifiedValue: 'Immutable determined state produced from a frozen snapshot.',
        marketIntelligence: 'What the market indicates may happen.',
        verifiedMarketEvents: 'What actually happened and became evidence.'
      },
      counts: {
        verifiedValueRecords: records.length,
        canonicalVerifiedValueRecords: canonicalRecords.length,
        activeSignals: signals.filter((item) => item.status === 'ACTIVE_SIGNAL').length,
        verifiedMarketEvents: events.length
      }
    };
  }
}

export { SIGNAL_TYPES, EVENT_TYPES };
