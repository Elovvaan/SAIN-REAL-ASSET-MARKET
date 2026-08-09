import test from 'node:test';
import assert from 'node:assert/strict';
import { OnChainProjectionService } from '../services/on-chain-projection-service.js';
import {
  InstrumentRepresentationApprovalService,
  INSTRUMENT_REPRESENTATION_APPROVAL_TYPE,
} from '../services/instrument-representation-approval-service.js';
import { PersistentDomainService, RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async lifecycle(input) {
    const id = `LE-${this.records.size + 1}`;
    const event = { id, ...structuredClone(input), occurredAt: new Date().toISOString() };
    await this.put(RECORD_TYPES.LIFECYCLE_EVENT, id, event);
    return event;
  }
}

class MemoryDatabase {
  constructor() { this.records = new Map(); this.audits = []; this.pool = null; }
  key(type, id) { return `${type}:${id}`; }
  async listRecords(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value));
  }
  async putRecord(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); }
  async audit(event) { this.audits.push(structuredClone(event)); }
}

function projectionReadyInstrument(instrumentId = 'INS-READY-1') {
  return {
    instrumentId,
    state: 'ISSUED',
    issuerParticipantId: 'PARTICIPANT-1',
    verifiedValuePackageId: 'VVP-1',
    authorizedSupply: 1000,
    purpose: 'CONTROLLED_REPRESENTATION',
    transferabilityStatus: 'RESTRICTED',
    unitDefinition: 'ONE_UNIT_EQUALS_ONE_AUTHORIZED_INSTRUMENT_UNIT',
    governingRecordDigest: 'sha256:test',
    currency: 'USD',
  };
}

test('on-chain projection is blocked until administrator representation approval exists', async () => {
  const domain = new MemoryDomain();
  const instrument = projectionReadyInstrument();
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, instrument.instrumentId, instrument);

  const service = new OnChainProjectionService(domain);
  const before = service.evaluateInstrument(instrument.instrumentId);
  assert.equal(before.eligible, false);
  assert.deepEqual(before.blockers, ['INSTRUMENT_REPRESENTATION_APPROVAL_REQUIRED']);

  await assert.rejects(
    service.createProjection({ instrumentId: instrument.instrumentId }, 'ADMIN-1'),
    (error) => error.code === 'PROJECTION_INELIGIBLE'
      && error.assessment.blockers.includes('INSTRUMENT_REPRESENTATION_APPROVAL_REQUIRED'),
  );
});

test('approved representation unlocks projection creation and is carried into projection lineage', async () => {
  const domain = new MemoryDomain();
  const instrument = projectionReadyInstrument('INS-READY-2');
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, instrument.instrumentId, instrument);

  const approvals = new InstrumentRepresentationApprovalService(domain);
  const approvalResult = await approvals.approve(instrument.instrumentId, 'ADMIN-1');
  assert.equal(approvalResult.changed, true);

  const service = new OnChainProjectionService(domain);
  const assessment = service.evaluateInstrument(instrument.instrumentId);
  assert.equal(assessment.eligible, true);
  assert.equal(assessment.representationApproval.approvalId, `IRA-${instrument.instrumentId}`);

  const projection = await service.createProjection({ instrumentId: instrument.instrumentId }, 'ADMIN-1');
  assert.equal(projection.instrumentId, instrument.instrumentId);
  assert.equal(projection.representationApprovalId, `IRA-${instrument.instrumentId}`);
});

test('representation approval keeps the same cache identity after hydration and remains idempotent', async () => {
  const database = new MemoryDatabase();
  const firstDomain = new PersistentDomainService(database);
  const instrument = projectionReadyInstrument('INS-HYDRATE-1');
  await firstDomain.put(RECORD_TYPES.SRA_INSTRUMENT, instrument.instrumentId, instrument, { audit: false });

  const firstService = new InstrumentRepresentationApprovalService(firstDomain);
  const firstApproval = await firstService.approve(instrument.instrumentId, 'ADMIN-1');
  assert.equal(firstApproval.changed, true);
  assert.equal(firstApproval.approval.id, `IRA-${instrument.instrumentId}`);

  const restartedDomain = new PersistentDomainService(database);
  await restartedDomain.hydrate([RECORD_TYPES.SRA_INSTRUMENT, INSTRUMENT_REPRESENTATION_APPROVAL_TYPE]);
  const restartedService = new InstrumentRepresentationApprovalService(restartedDomain);

  assert.equal(restartedService.get(instrument.instrumentId)?.approvalId, `IRA-${instrument.instrumentId}`);
  const secondApproval = await restartedService.approve(instrument.instrumentId, 'ADMIN-2');
  assert.equal(secondApproval.changed, false);
  assert.equal(restartedDomain.list(INSTRUMENT_REPRESENTATION_APPROVAL_TYPE).length, 1);
  assert.equal(secondApproval.approval.approvedBy, 'ADMIN-1');
});
