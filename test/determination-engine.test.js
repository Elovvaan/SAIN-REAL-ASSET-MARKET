import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterminationEngineService, DETERMINATION_RECORD_TYPES } from '../services/determination-engine-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.lifecycleEvents = []; }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() { return {}; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async atomicPut(changes) {
    for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload));
    return changes.map((change) => structuredClone(change.payload));
  }
  async lifecycle(input) { this.lifecycleEvents.push(structuredClone(input)); return input; }
}

async function buildSubject(service, permittedUses = ['INTERNAL_ANALYSIS', 'CONTRACT_REFERENCE']) {
  return service.registerSubject({
    subjectType: 'BTC_USD_REFERENCE',
    label: 'BTC/USD market activity',
    externalReference: 'BTC-USD',
    permittedUses,
    identity: { baseAsset: 'BTC', quoteAsset: 'USD' },
    provenance: { owner: 'SRA', basis: 'permitted observations' },
  }, 'ADMIN-1');
}

async function addObservation(service, subjectId, sourceId, value, observedAt, weight = 1) {
  return service.recordObservation({
    subjectId,
    sourceId,
    sourceType: 'MARKET_DATA_SOURCE',
    value,
    currency: 'USD',
    unit: 'BTC',
    weight,
    observedAt,
    evidenceReference: `${sourceId}:${observedAt}`,
    permission: 'CONTRACT_REFERENCE',
  }, 'ADMIN-1');
}

test('subject identity exists independently from observed value', async () => {
  const domain = new MemoryDomain();
  const service = new DeterminationEngineService(domain);
  const subject = await buildSubject(service);
  assert.match(subject.subjectId, /^SUBJ-/);
  assert.equal(subject.subjectType, 'BTC_USD_REFERENCE');
  assert.equal('value' in subject, false);
  assert.deepEqual(subject.permittedUses, ['INTERNAL_ANALYSIS', 'CONTRACT_REFERENCE']);
});

test('snapshot freezes subject observations and produces an evidence hash', async () => {
  const domain = new MemoryDomain();
  const service = new DeterminationEngineService(domain);
  const subject = await buildSubject(service);
  const a = await addObservation(service, subject.subjectId, 'SOURCE-A', 9980, '2026-08-07T14:00:00.000Z');
  const b = await addObservation(service, subject.subjectId, 'SOURCE-B', 10010, '2026-08-07T14:05:00.000Z');
  const snapshot = await service.createSnapshot({
    subjectId: subject.subjectId,
    observationIds: [a.observationId, b.observationId],
    methodologyVersion: 'VV-MARKET-1.0',
    permittedUses: ['CONTRACT_REFERENCE'],
  }, 'ADMIN-1');
  assert.match(snapshot.snapshotId, /^SNP-/);
  assert.equal(snapshot.state, 'FROZEN');
  assert.equal(snapshot.immutable, true);
  assert.equal(snapshot.observations.length, 2);
  assert.match(snapshot.evidenceHash, /^[a-f0-9]{64}$/);

  const storedObservation = domain.get(DETERMINATION_RECORD_TYPES.OBSERVATION, a.observationId);
  storedObservation.value = 1;
  await domain.put(DETERMINATION_RECORD_TYPES.OBSERVATION, a.observationId, storedObservation);
  assert.equal(domain.get(DETERMINATION_RECORD_TYPES.SNAPSHOT, snapshot.snapshotId).observations[0].value, 9980);
});

test('determination creates a canonical VVR without crossing the contract-formation boundary', async () => {
  const domain = new MemoryDomain();
  const service = new DeterminationEngineService(domain);
  const subject = await buildSubject(service);
  const observations = [
    await addObservation(service, subject.subjectId, 'SOURCE-A', 9980, '2026-08-07T14:00:00.000Z'),
    await addObservation(service, subject.subjectId, 'SOURCE-B', 10010, '2026-08-07T14:05:00.000Z'),
    await addObservation(service, subject.subjectId, 'SOURCE-C', 10000, '2026-08-07T14:10:00.000Z'),
  ];
  const snapshot = await service.createSnapshot({
    subjectId: subject.subjectId,
    observationIds: observations.map((item) => item.observationId),
    methodologyVersion: 'VV-MARKET-1.0',
    permittedUses: ['CONTRACT_REFERENCE'],
  }, 'ADMIN-1');
  const result = await service.determine({ snapshotId: snapshot.snapshotId, methodology: 'MEDIAN' }, 'ADMIN-1');
  assert.equal(result.determination.determinedValue, 10000);
  assert.equal(result.determination.snapshotId, snapshot.snapshotId);
  assert.equal(result.verifiedValueRecord.value, 10000);
  assert.equal(result.verifiedValueRecord.determinationId, result.determination.determinationId);
  assert.equal(result.verifiedValueRecord.contractFormationBoundary.referenceOnly, true);
  assert.equal(result.verifiedValueRecord.contractFormationBoundary.createsAgreement, false);
  assert.equal(result.verifiedValueRecord.contractFormationBoundary.createsRights, false);
  assert.equal(result.verifiedValueRecord.contractFormationBoundary.createsOwnership, false);
  assert.equal(result.verifiedValueRecord.contractFormationBoundary.createsInstrument, false);
  assert.equal(result.verifiedValueRecord.confidence.level, 'HIGH');
});

test('new determinations version recognized state instead of overwriting prior VVRs', async () => {
  const domain = new MemoryDomain();
  const service = new DeterminationEngineService(domain);
  const subject = await buildSubject(service);

  const firstObs = await addObservation(service, subject.subjectId, 'SOURCE-A', 10000, '2026-08-07T14:00:00.000Z');
  const firstSnapshot = await service.createSnapshot({ subjectId: subject.subjectId, observationIds: [firstObs.observationId], methodologyVersion: 'VV-1.0', permittedUses: ['CONTRACT_REFERENCE'] });
  const first = await service.determine({ snapshotId: firstSnapshot.snapshotId, methodology: 'MEDIAN' });

  const secondObs = await addObservation(service, subject.subjectId, 'SOURCE-A', 9200, '2026-09-06T14:00:00.000Z');
  const secondSnapshot = await service.createSnapshot({ subjectId: subject.subjectId, observationIds: [secondObs.observationId], methodologyVersion: 'VV-1.0', permittedUses: ['CONTRACT_REFERENCE'] });
  const second = await service.determine({ snapshotId: secondSnapshot.snapshotId, methodology: 'MEDIAN' });

  assert.notEqual(first.verifiedValueRecord.verifiedValueRecordId, second.verifiedValueRecord.verifiedValueRecordId);
  assert.equal(domain.get(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, first.verifiedValueRecord.verifiedValueRecordId).value, 10000);
  assert.equal(domain.get(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, second.verifiedValueRecord.verifiedValueRecordId).value, 9200);
  const history = service.subjectHistory(subject.subjectId);
  assert.equal(history.verifiedValueRecords.length, 2);
  assert.deepEqual(history.verifiedValueRecords.map((item) => item.value), [10000, 9200]);
});

test('snapshot cannot claim uses outside the subject permission boundary', async () => {
  const domain = new MemoryDomain();
  const service = new DeterminationEngineService(domain);
  const subject = await buildSubject(service, ['INTERNAL_ANALYSIS']);
  const observation = await addObservation(service, subject.subjectId, 'SOURCE-A', 10000, '2026-08-07T14:00:00.000Z');
  await assert.rejects(
    service.createSnapshot({ subjectId: subject.subjectId, observationIds: [observation.observationId], methodologyVersion: 'VV-1.0', permittedUses: ['CONTRACT_REFERENCE'] }),
    /not permitted by the subject/i,
  );
});

test('snapshot rejects observations belonging to another subject', async () => {
  const domain = new MemoryDomain();
  const service = new DeterminationEngineService(domain);
  const first = await buildSubject(service);
  const second = await service.registerSubject({ subjectType: 'OTHER', permittedUses: ['CONTRACT_REFERENCE'] });
  const observation = await addObservation(service, second.subjectId, 'SOURCE-X', 50, '2026-08-07T14:00:00.000Z');
  await assert.rejects(
    service.createSnapshot({ subjectId: first.subjectId, observationIds: [observation.observationId], methodologyVersion: 'VV-1.0', permittedUses: ['CONTRACT_REFERENCE'] }),
    /different subject/i,
  );
});
