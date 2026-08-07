import crypto from 'node:crypto';

export const DETERMINATION_RECORD_TYPES = Object.freeze({
  SUBJECT: 'SRA_DETERMINATION_SUBJECT',
  OBSERVATION: 'SRA_DETERMINATION_OBSERVATION',
  SNAPSHOT: 'SRA_DETERMINATION_SNAPSHOT',
  DETERMINATION: 'SRA_VALUE_DETERMINATION',
  VERIFIED_VALUE: 'SRA_CANONICAL_VERIFIED_VALUE_RECORD',
});

const METHODS = new Set(['MEDIAN', 'WEIGHTED_MEAN', 'LATEST', 'DIRECT']);

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function clean(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
}

function number(value, label = 'value') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number.`);
  return parsed;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function weightedMean(observations) {
  const totals = observations.reduce((result, item) => {
    const weight = Number.isFinite(Number(item.weight)) && Number(item.weight) > 0 ? Number(item.weight) : 1;
    return { weighted: result.weighted + Number(item.value) * weight, weight: result.weight + weight };
  }, { weighted: 0, weight: 0 });
  return totals.weighted / totals.weight;
}

function calculate(method, observations, directValue) {
  if (method === 'DIRECT') return number(directValue, 'directValue');
  if (!observations.length) throw new Error('At least one frozen observation is required for this methodology.');
  if (method === 'MEDIAN') return median(observations.map((item) => number(item.value, 'observation value')));
  if (method === 'WEIGHTED_MEAN') return weightedMean(observations);
  if (method === 'LATEST') {
    const latest = [...observations].sort((a, b) => new Date(b.observedAt || 0) - new Date(a.observedAt || 0))[0];
    return number(latest.value, 'observation value');
  }
  throw new Error(`Unsupported determination methodology: ${method}.`);
}

function deriveConfidence(observations) {
  if (!observations.length) return { level: 'NOT_APPLICABLE', sourceCount: 0, observationCount: 0, spreadRatio: null };
  const sourceCount = new Set(observations.map((item) => item.sourceId).filter(Boolean)).size;
  const values = observations.map((item) => Number(item.value)).filter(Number.isFinite);
  const center = median(values);
  const spread = Math.max(...values) - Math.min(...values);
  const spreadRatio = center === 0 ? (spread === 0 ? 0 : null) : Math.abs(spread / center);
  let level = 'LOW';
  if (observations.length >= 3 && sourceCount >= 2 && spreadRatio !== null && spreadRatio <= 0.02) level = 'HIGH';
  else if (observations.length >= 2 && sourceCount >= 2 && spreadRatio !== null && spreadRatio <= 0.05) level = 'MODERATE';
  return { level, sourceCount, observationCount: observations.length, spreadRatio };
}

function sortByTime(records, key) {
  return [...records].sort((a, b) => new Date(a?.[key] || 0) - new Date(b?.[key] || 0));
}

export class DeterminationEngineService {
  constructor(domain) {
    this.domain = domain;
  }

  async initialize() {
    await this.domain.hydrate?.(Object.values(DETERMINATION_RECORD_TYPES));
    return this.status();
  }

  status() {
    return {
      architecture: 'SUBJECT_OBSERVATION_SNAPSHOT_DETERMINATION_VERIFIED_VALUE',
      contractFormationBoundary: true,
      counts: Object.fromEntries(Object.entries(DETERMINATION_RECORD_TYPES).map(([key, type]) => [key.toLowerCase(), this.domain.list(type).length])),
    };
  }

  async registerSubject(input = {}, actorId = null) {
    const subjectType = clean(input.subjectType, 100).toUpperCase();
    if (!subjectType) throw new Error('subjectType is required.');
    const externalReference = clean(input.externalReference, 180) || null;
    const subjectId = clean(input.subjectId, 100) || makeId('SUBJ');
    if (this.domain.get(DETERMINATION_RECORD_TYPES.SUBJECT, subjectId)) throw new Error('Determination subject already exists.');
    const permittedUses = [...new Set(list(input.permittedUses).map((item) => clean(String(item), 120).toUpperCase()).filter(Boolean))];
    const record = {
      id: subjectId,
      subjectId,
      subjectType,
      label: clean(input.label, 200) || subjectId,
      externalReference,
      identity: input.identity && typeof input.identity === 'object' ? structuredClone(input.identity) : {},
      provenance: input.provenance && typeof input.provenance === 'object' ? structuredClone(input.provenance) : {},
      permittedUses,
      state: 'REGISTERED',
      createdAt: now(),
      createdBy: actorId,
    };
    await this.domain.put(DETERMINATION_RECORD_TYPES.SUBJECT, subjectId, record, { actorId, eventType: 'DETERMINATION_SUBJECT_REGISTERED' });
    return record;
  }

  async recordObservation(input = {}, actorId = null) {
    const subjectId = clean(input.subjectId, 100);
    const subject = this.domain.get(DETERMINATION_RECORD_TYPES.SUBJECT, subjectId);
    if (!subject) throw new Error('Determination subject not found.');
    const observationId = clean(input.observationId, 100) || makeId('OBS');
    if (this.domain.get(DETERMINATION_RECORD_TYPES.OBSERVATION, observationId)) throw new Error('Observation already exists.');
    const observedAt = clean(input.observedAt, 64) || now();
    if (Number.isNaN(new Date(observedAt).getTime())) throw new Error('observedAt must be a valid date/time.');
    const sourceId = clean(input.sourceId, 160);
    if (!sourceId) throw new Error('sourceId is required.');
    const record = {
      id: observationId,
      observationId,
      subjectId,
      sourceId,
      sourceType: clean(input.sourceType, 100).toUpperCase() || 'PERMITTED_SOURCE',
      value: number(input.value),
      unit: clean(input.unit, 40).toUpperCase() || null,
      currency: clean(input.currency, 16).toUpperCase() || null,
      weight: Number.isFinite(Number(input.weight)) && Number(input.weight) > 0 ? Number(input.weight) : 1,
      observedAt,
      receivedAt: now(),
      evidenceReference: clean(input.evidenceReference, 300) || null,
      evidenceHash: clean(input.evidenceHash, 128) || null,
      permission: clean(input.permission, 120).toUpperCase() || 'INTERNAL_ANALYSIS',
      quality: input.quality && typeof input.quality === 'object' ? structuredClone(input.quality) : {},
      metadata: input.metadata && typeof input.metadata === 'object' ? structuredClone(input.metadata) : {},
      state: 'OBSERVED',
      createdBy: actorId,
    };
    await this.domain.put(DETERMINATION_RECORD_TYPES.OBSERVATION, observationId, record, { actorId, eventType: 'DETERMINATION_OBSERVATION_RECORDED' });
    return record;
  }

  async createSnapshot(input = {}, actorId = null) {
    const subjectId = clean(input.subjectId, 100);
    const subject = this.domain.get(DETERMINATION_RECORD_TYPES.SUBJECT, subjectId);
    if (!subject) throw new Error('Determination subject not found.');
    const observationIds = [...new Set(list(input.observationIds).map((item) => clean(String(item), 100)).filter(Boolean))];
    if (!observationIds.length) throw new Error('Snapshot requires at least one observation.');
    const observations = observationIds.map((id) => {
      const observation = this.domain.get(DETERMINATION_RECORD_TYPES.OBSERVATION, id);
      if (!observation) throw new Error(`Observation ${id} not found.`);
      if (observation.subjectId !== subjectId) throw new Error(`Observation ${id} belongs to a different subject.`);
      return observation;
    });
    const observationStart = clean(input.observationStart, 64) || sortByTime(observations, 'observedAt')[0].observedAt;
    const observationEnd = clean(input.observationEnd, 64) || sortByTime(observations, 'observedAt').at(-1).observedAt;
    if (new Date(observationStart) > new Date(observationEnd)) throw new Error('observationStart must be before observationEnd.');
    const methodologyVersion = clean(input.methodologyVersion, 120);
    if (!methodologyVersion) throw new Error('methodologyVersion is required when freezing a snapshot.');
    const permittedUses = [...new Set(list(input.permittedUses).map((item) => clean(String(item), 120).toUpperCase()).filter(Boolean))];
    if (subject.permittedUses?.length) {
      const disallowed = permittedUses.filter((use) => !subject.permittedUses.includes(use));
      if (disallowed.length) throw new Error(`Snapshot requests uses not permitted by the subject: ${disallowed.join(', ')}.`);
    }
    const frozenObservations = observations.map((item) => ({
      observationId: item.observationId,
      sourceId: item.sourceId,
      sourceType: item.sourceType,
      value: item.value,
      unit: item.unit,
      currency: item.currency,
      weight: item.weight,
      observedAt: item.observedAt,
      evidenceReference: item.evidenceReference,
      evidenceHash: item.evidenceHash,
      permission: item.permission,
      quality: item.quality,
    }));
    const snapshotId = makeId('SNP');
    const frozenAt = now();
    const evidenceHash = hash({ subjectId, observationStart, observationEnd, methodologyVersion, permittedUses, observations: frozenObservations });
    const record = {
      id: snapshotId,
      snapshotId,
      subjectId,
      observationStart,
      observationEnd,
      observationIds,
      observations: frozenObservations,
      methodologyVersion,
      exclusions: list(input.exclusions).map((item) => structuredClone(item)),
      permittedUses,
      evidenceHash,
      frozenAt,
      state: 'FROZEN',
      immutable: true,
      createdBy: actorId,
    };
    await this.domain.put(DETERMINATION_RECORD_TYPES.SNAPSHOT, snapshotId, record, { actorId, eventType: 'DETERMINATION_SNAPSHOT_FROZEN' });
    return record;
  }

  async determine(input = {}, actorId = null) {
    const snapshotId = clean(input.snapshotId, 100);
    const snapshot = this.domain.get(DETERMINATION_RECORD_TYPES.SNAPSHOT, snapshotId);
    if (!snapshot) throw new Error('Determination snapshot not found.');
    if (snapshot.state !== 'FROZEN' || snapshot.immutable !== true) throw new Error('Only an immutable frozen snapshot can be determined.');
    const methodology = clean(input.methodology, 80).toUpperCase() || 'MEDIAN';
    if (!METHODS.has(methodology)) throw new Error(`Unsupported determination methodology: ${methodology}.`);
    const methodologyVersion = clean(input.methodologyVersion, 120) || snapshot.methodologyVersion;
    if (!methodologyVersion) throw new Error('methodologyVersion is required.');
    const determinedValue = calculate(methodology, snapshot.observations || [], input.directValue);
    const confidence = input.confidence && typeof input.confidence === 'object'
      ? structuredClone(input.confidence)
      : deriveConfidence(snapshot.observations || []);
    const determinationId = makeId('DET');
    const verifiedValueRecordId = makeId('VVR');
    const determinedAt = now();
    const determinationHash = hash({
      snapshotId,
      subjectId: snapshot.subjectId,
      methodology,
      methodologyVersion,
      determinedValue,
      confidence,
      evidenceHash: snapshot.evidenceHash,
    });
    const determination = {
      id: determinationId,
      determinationId,
      subjectId: snapshot.subjectId,
      snapshotId,
      methodology,
      methodologyVersion,
      determinedValue,
      unit: clean(input.unit, 40).toUpperCase() || snapshot.observations?.find((item) => item.unit)?.unit || null,
      currency: clean(input.currency, 16).toUpperCase() || snapshot.observations?.find((item) => item.currency)?.currency || null,
      confidence,
      evidenceHash: snapshot.evidenceHash,
      determinationHash,
      permittedUses: snapshot.permittedUses || [],
      determinedAt,
      state: 'DETERMINED',
      immutable: true,
      createdBy: actorId,
    };
    const verifiedValueRecord = {
      id: verifiedValueRecordId,
      verifiedValueRecordId,
      subjectId: snapshot.subjectId,
      snapshotId,
      determinationId,
      value: determinedValue,
      unit: determination.unit,
      currency: determination.currency,
      methodology,
      methodologyVersion,
      confidence,
      evidenceHash: snapshot.evidenceHash,
      determinationHash,
      permittedUses: snapshot.permittedUses || [],
      determinedAt,
      state: 'CANONICAL',
      immutable: true,
      contractFormationBoundary: {
        referenceOnly: true,
        createsAgreement: false,
        createsRights: false,
        createsOwnership: false,
        createsInstrument: false,
      },
      createdBy: actorId,
    };
    await this.domain.atomicPut([
      { type: DETERMINATION_RECORD_TYPES.DETERMINATION, id: determinationId, payload: determination, actorId, eventType: 'VALUE_DETERMINATION_RECORDED' },
      { type: DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, id: verifiedValueRecordId, payload: verifiedValueRecord, actorId, eventType: 'CANONICAL_VERIFIED_VALUE_RECORDED' },
    ]);
    await this.domain.lifecycle?.({
      actorId,
      objectType: DETERMINATION_RECORD_TYPES.VERIFIED_VALUE,
      objectId: verifiedValueRecordId,
      eventType: 'DETERMINATION_CHAIN_COMPLETED',
      payload: { subjectId: snapshot.subjectId, snapshotId, determinationId, verifiedValueRecordId },
    });
    return { determination, verifiedValueRecord };
  }

  subjectHistory(subjectId) {
    const id = clean(subjectId, 100);
    const subject = this.domain.get(DETERMINATION_RECORD_TYPES.SUBJECT, id);
    if (!subject) throw new Error('Determination subject not found.');
    return {
      subject,
      observations: sortByTime(this.domain.list(DETERMINATION_RECORD_TYPES.OBSERVATION).filter((item) => item.subjectId === id), 'observedAt'),
      snapshots: sortByTime(this.domain.list(DETERMINATION_RECORD_TYPES.SNAPSHOT).filter((item) => item.subjectId === id), 'frozenAt'),
      determinations: sortByTime(this.domain.list(DETERMINATION_RECORD_TYPES.DETERMINATION).filter((item) => item.subjectId === id), 'determinedAt'),
      verifiedValueRecords: sortByTime(this.domain.list(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE).filter((item) => item.subjectId === id), 'determinedAt'),
    };
  }
}

export { METHODS as DETERMINATION_METHODS };
