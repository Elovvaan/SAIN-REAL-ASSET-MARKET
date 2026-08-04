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

function normalizedList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).map((item) => typeof item === 'string' ? { type: item } : item);
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
      .filter((record) => !filters.recognitionState || record.recognitionState === filters.recognitionState)
      .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
  }

  get(observationId) {
    return this.persistentDomain.get(RECORD_TYPES.MARKET_OBSERVATION, observationId);
  }

  listRecognitions(filters = {}) {
    return this.persistentDomain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT)
      .filter((record) => !filters.observationId || record.observationId === filters.observationId)
      .filter((record) => !filters.state || record.state === filters.state)
      .filter((record) => !filters.classification || record.classification?.type === filters.classification)
      .sort((a, b) => String(b.assessedAt).localeCompare(String(a.assessedAt)));
  }

  getRecognition(recognitionId) {
    return this.persistentDomain.get(RECORD_TYPES.RECOGNITION_ASSESSMENT, recognitionId);
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
      currentRecognitionId: null,
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

  async recognize(observationId, input = {}, actorId = 'SAIN_AGENT') {
    const observation = this.get(observationId);
    if (!observation) throw new Error('Observation not found.');

    const identity = {
      subjectType: requireText(input.identity?.subjectType, 'identity.subjectType').toUpperCase(),
      subjectId: requireText(input.identity?.subjectId, 'identity.subjectId'),
      displayName: input.identity?.displayName || null
    };
    const source = {
      market: observation.sourceMarket,
      sourceRecordId: observation.sourceRecordId,
      sourceRecordType: observation.sourceRecordType,
      payloadDigest: observation.payloadDigest,
      sourceReference: observation.sourceReference,
      sourceTimestamp: observation.sourceTimestamp,
      observedAt: observation.observedAt
    };
    const authority = {
      basis: requireText(input.authority?.basis, 'authority.basis').toUpperCase(),
      scope: requireText(input.authority?.scope, 'authority.scope'),
      reference: input.authority?.reference || null
    };
    const evidence = {
      items: normalizedList(input.evidence?.items),
      sourcePayloadIncluded: true,
      evidenceDigest: digest({ observationDigest: observation.payloadDigest, items: normalizedList(input.evidence?.items) })
    };
    const classification = {
      type: requireText(input.classification?.type, 'classification.type').toUpperCase(),
      category: input.classification?.category || observation.category || null,
      description: input.classification?.description || null
    };
    const relationships = normalizedList(input.relationships);
    const measurement = {
      method: requireText(input.measurement?.method, 'measurement.method').toUpperCase(),
      unit: requireText(input.measurement?.unit, 'measurement.unit').toUpperCase(),
      value: Number(input.measurement?.value),
      asOf: input.measurement?.asOf || observation.sourceTimestamp || observation.observedAt,
      inputs: input.measurement?.inputs || observation.rawValues || {},
      methodologyReference: input.measurement?.methodologyReference || null
    };
    if (!Number.isFinite(measurement.value)) throw new Error('measurement.value must be a finite number.');

    const decision = String(input.decision || 'RECOGNIZED').toUpperCase();
    if (!['RECOGNIZED', 'IN_REVIEW', 'REJECTED'].includes(decision)) throw new Error('decision must be RECOGNIZED, IN_REVIEW, or REJECTED.');

    const recognitionId = `REC-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const now = new Date().toISOString();
    const assessment = {
      recognitionId,
      observationId,
      engine: 'SAIN_RECOGNITION_ENGINE',
      version: 3,
      phase: 2,
      identity,
      source,
      authority,
      evidence,
      classification,
      relationships,
      measurement,
      decision,
      state: decision,
      rationale: input.rationale || null,
      limitations: Array.isArray(input.limitations) ? input.limitations : [],
      assessedBy: actorId,
      assessedAt: now,
      recognitionDigest: digest({ observationId, identity, source, authority, evidence, classification, relationships, measurement, decision })
    };

    await this.persistentDomain.put(RECORD_TYPES.RECOGNITION_ASSESSMENT, recognitionId, assessment, {
      actorId,
      eventType: 'MARKET_OBSERVATION_RECOGNIZED'
    });
    const updatedObservation = {
      ...observation,
      recognitionState: decision,
      currentRecognitionId: recognitionId,
      lastRecognizedAt: now,
      lastRecognizedBy: actorId
    };
    await this.persistentDomain.put(RECORD_TYPES.MARKET_OBSERVATION, observationId, updatedObservation, {
      actorId,
      eventType: 'MARKET_OBSERVATION_RECOGNITION_STATE_CHANGED'
    });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.RECOGNITION_ASSESSMENT,
      objectId: recognitionId,
      eventType: 'SAIN_RECOGNITION_ASSESSMENT_RECORDED',
      actorId,
      payload: { observationId, decision, classification: classification.type, measurement }
    });

    return { recognition: assessment, observation: updatedObservation };
  }

  summary() {
    const observations = this.list();
    const recognitions = this.listRecognitions();
    const byMarket = {};
    const byType = {};
    const byRecognitionState = {};
    for (const observation of observations) {
      byMarket[observation.sourceMarket] = (byMarket[observation.sourceMarket] || 0) + 1;
      byType[observation.sourceRecordType] = (byType[observation.sourceRecordType] || 0) + 1;
      byRecognitionState[observation.recognitionState] = (byRecognitionState[observation.recognitionState] || 0) + 1;
    }
    return {
      phase: 2,
      layer: 'SAIN_RECOGNITION_ENGINE',
      version: 3,
      observationCount: observations.length,
      recognitionCount: recognitions.length,
      byMarket,
      byType,
      byRecognitionState,
      latestObservedAt: observations[0]?.observedAt || null,
      latestRecognizedAt: recognitions[0]?.assessedAt || null
    };
  }
}
