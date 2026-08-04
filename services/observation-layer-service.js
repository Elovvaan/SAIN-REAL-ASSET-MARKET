import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

export class ObservationLayerService {
  constructor(persistentDomain) {
    this.persistentDomain = persistentDomain;
  }

  list(filters = {}) {
    return this.persistentDomain.list(RECORD_TYPES.MARKET_OBSERVATION)
      .filter((record) => !filters.market || record.sourceMarket === filters.market)
      .filter((record) => !filters.recordType || record.sourceRecordType === filters.recordType)
      .filter((record) => !filters.state || record.state === filters.state)
      .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
  }

  get(observationId) {
    return this.persistentDomain.get(RECORD_TYPES.MARKET_OBSERVATION, observationId);
  }

  async observe(input, actorId = 'SRA_PLATFORM') {
    const sourceMarket = requireText(input.sourceMarket, 'sourceMarket').toUpperCase();
    const sourceRecordId = requireText(input.sourceRecordId, 'sourceRecordId');
    const sourceRecordType = requireText(input.sourceRecordType, 'sourceRecordType').toUpperCase();
    if (input.rawPayload === undefined) throw new Error('rawPayload is required.');

    const payloadDigest = digest(input.rawPayload);
    const observationKey = `${sourceMarket}:${sourceRecordType}:${sourceRecordId}:${payloadDigest}`;
    const existing = this.list().find((item) => item.observationKey === observationKey);
    if (existing) return { observation: existing, created: false };

    const observationId = `OBS-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const now = new Date().toISOString();
    const observation = {
      observationId,
      observationKey,
      sourceMarket,
      sourceRecordId,
      sourceRecordType,
      sourceTimestamp: input.sourceTimestamp || null,
      observedAt: now,
      connectorId: input.connectorId || null,
      category: input.category || null,
      rawValues: input.rawValues || {},
      rawPayload: input.rawPayload,
      payloadDigest,
      sourceReference: input.sourceReference || null,
      state: 'OBSERVED',
      recognitionState: 'UNPROCESSED',
      createdBy: actorId,
      createdAt: now
    };

    await this.persistentDomain.put(RECORD_TYPES.MARKET_OBSERVATION, observationId, observation, {
      actorId,
      eventType: 'MARKET_OBSERVATION_RECORDED'
    });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.MARKET_OBSERVATION,
      objectId: observationId,
      eventType: 'MARKET_OBSERVATION_RECORDED',
      actorId,
      payload: { sourceMarket, sourceRecordType, sourceRecordId, payloadDigest }
    });

    return { observation, created: true };
  }

  summary() {
    const observations = this.list();
    const byMarket = {};
    const byType = {};
    for (const observation of observations) {
      byMarket[observation.sourceMarket] = (byMarket[observation.sourceMarket] || 0) + 1;
      byType[observation.sourceRecordType] = (byType[observation.sourceRecordType] || 0) + 1;
    }
    return {
      phase: 1,
      layer: 'OBSERVATION_LAYER',
      version: 3,
      observationCount: observations.length,
      byMarket,
      byType,
      latestObservedAt: observations[0]?.observedAt || null
    };
  }
}
