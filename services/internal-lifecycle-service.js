import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const STAGES = Object.freeze([
  ['observation', RECORD_TYPES.MARKET_OBSERVATION, 'observationId'],
  ['recognition', RECORD_TYPES.RECOGNITION_ASSESSMENT, 'recognitionId'],
  ['financialRecord', RECORD_TYPES.FINANCIAL_RECORD, 'financialRecordId'],
  ['coinPosition', RECORD_TYPES.COIN_POSITION, 'coinPositionId'],
  ['instrument', RECORD_TYPES.SRA_INSTRUMENT, 'instrumentId'],
  ['listing', RECORD_TYPES.MARKETPLACE_LISTING, 'listingId'],
  ['participation', RECORD_TYPES.PARTICIPATION_POSITION, 'positionId'],
  ['commitment', RECORD_TYPES.FUNDING_MARKETPLACE_COMMITMENT, 'commitmentId'],
  ['allocation', RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, 'positionId'],
  ['settlement', RECORD_TYPES.SRA_SETTLEMENT_RECORD, 'settlementRecordId'],
]);

const ACCEPTED_STATES = Object.freeze({
  observation: ['OBSERVED', 'ACTIVE', 'COMPLETE'],
  recognition: ['RECOGNIZED', 'APPROVED', 'VERIFIED'],
  financialRecord: ['RECORDED', 'ACTIVE', 'VERIFIED'],
  coinPosition: ['ACTIVE', 'CREATED', 'MINTED'],
  instrument: ['ISSUED', 'ACTIVE'],
  listing: ['PUBLISHED', 'ACTIVE', 'LIVE'],
  participation: ['ACTIVE', 'PARTICIPATING', 'CONFIRMED'],
  commitment: ['COMMITTED', 'ACTIVE', 'CONFIRMED'],
  allocation: ['ALLOCATED', 'ACTIVE', 'SETTLED'],
  settlement: ['SETTLED', 'COMPLETE', 'COMPLETED'],
  ownershipRecognition: ['RECOGNIZED'],
});

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function findById(domain, type, idField, id) {
  if (!id) return null;
  const direct = domain.get(type, id);
  if (direct) return direct;
  return domain.list(type).find((record) => record?.[idField] === id) || null;
}

function normalizedState(stageName, record) {
  const value = stageName === 'recognition'
    ? record?.decision || record?.recognitionState || record?.state
    : record?.state || record?.status;
  return String(value || '').toUpperCase();
}

function addLinkIssue(issues, stages, fromStage, field, toStage) {
  const from = stages[fromStage];
  const to = stages[toStage];
  if (!from?.present || !to?.present) return;
  const actual = from.record?.[field];
  if (!actual || actual !== to.id) {
    issues.push({
      code: 'LIFECYCLE_LINK_MISMATCH',
      stage: fromStage,
      field,
      expected: to.id,
      actual: actual || null,
      message: `${fromStage}.${field} must reference ${toStage}.`,
    });
  }
}

function addSharedValueIssue(issues, stages, leftStage, leftField, rightStage, rightField = leftField) {
  const left = stages[leftStage];
  const right = stages[rightStage];
  if (!left?.present || !right?.present) return;
  const leftValue = left.record?.[leftField];
  const rightValue = right.record?.[rightField];
  if (leftValue && rightValue && leftValue !== rightValue) {
    issues.push({
      code: 'LIFECYCLE_VALUE_MISMATCH',
      stage: leftStage,
      field: leftField,
      expected: rightValue,
      actual: leftValue,
      message: `${leftStage}.${leftField} must match ${rightStage}.${rightField}.`,
    });
  }
}

function validateStages(stages) {
  const issues = [];

  for (const [stageName, accepted] of Object.entries(ACCEPTED_STATES)) {
    const stage = stages[stageName];
    if (!stage?.present) continue;
    const state = normalizedState(stageName, stage.record);
    if (!accepted.includes(state)) {
      issues.push({
        code: 'INVALID_LIFECYCLE_STATE',
        stage: stageName,
        actual: state || null,
        accepted,
        message: `${stageName} is not in an export-eligible state.`,
      });
    }
  }

  addLinkIssue(issues, stages, 'recognition', 'observationId', 'observation');
  addLinkIssue(issues, stages, 'financialRecord', 'recognitionId', 'recognition');
  addLinkIssue(issues, stages, 'coinPosition', 'financialRecordId', 'financialRecord');
  addLinkIssue(issues, stages, 'instrument', 'coinPositionId', 'coinPosition');
  addLinkIssue(issues, stages, 'listing', 'instrumentId', 'instrument');
  addLinkIssue(issues, stages, 'participation', 'listingId', 'listing');
  addLinkIssue(issues, stages, 'commitment', 'listingId', 'listing');
  addLinkIssue(issues, stages, 'allocation', 'commitmentId', 'commitment');
  addLinkIssue(issues, stages, 'allocation', 'instrumentId', 'instrument');
  addLinkIssue(issues, stages, 'allocation', 'listingId', 'listing');
  addLinkIssue(issues, stages, 'settlement', 'instrumentId', 'instrument');
  addLinkIssue(issues, stages, 'settlement', 'listingId', 'listing');
  addLinkIssue(issues, stages, 'ownershipRecognition', 'settlementRecordId', 'settlement');
  addLinkIssue(issues, stages, 'ownershipRecognition', 'allocationPositionId', 'allocation');

  addSharedValueIssue(issues, stages, 'participation', 'participantId', 'commitment', 'participantId');
  addSharedValueIssue(issues, stages, 'commitment', 'participantId', 'allocation', 'participantId');
  addSharedValueIssue(issues, stages, 'allocation', 'participantId', 'settlement', 'participantId');
  addSharedValueIssue(issues, stages, 'ownershipRecognition', 'ownerId', 'allocation', 'participantId');

  return issues;
}

export class InternalLifecycleService {
  constructor(persistentDomain) {
    this.persistentDomain = persistentDomain;
  }

  inspect(references = {}) {
    const stages = {};
    for (const [name, type, idField] of STAGES) {
      const id = references[`${name}Id`] || references[idField] || null;
      const record = findById(this.persistentDomain, type, idField, id);
      stages[name] = { id, present: Boolean(record), record };
    }

    const ownershipId = references.ownershipRecognitionId || null;
    const ownership = findById(this.persistentDomain, RECORD_TYPES.OWNERSHIP_RECOGNITION, 'ownershipRecognitionId', ownershipId);
    stages.ownershipRecognition = { id: ownershipId, present: Boolean(ownership), record: ownership };

    const missing = Object.entries(stages).filter(([, stage]) => !stage.present).map(([name]) => name);
    const issues = validateStages(stages);
    return {
      boundary: 'SRA_INTERNAL',
      complete: missing.length === 0 && issues.length === 0,
      missing,
      valid: issues.length === 0,
      issues,
      stages,
    };
  }

  async recognizeOwnership(input = {}, actorId = 'SRA_PLATFORM') {
    const settlementRecordId = requireText(input.settlementRecordId, 'settlementRecordId');
    const settlement = findById(this.persistentDomain, RECORD_TYPES.SRA_SETTLEMENT_RECORD, 'settlementRecordId', settlementRecordId);
    if (!settlement) throw new Error('Settlement record not found.');
    if (!ACCEPTED_STATES.settlement.includes(normalizedState('settlement', settlement))) throw new Error('Settlement record is not settled.');

    const ownerId = requireText(input.ownerId, 'ownerId');
    const sourcePositionId = requireText(input.sourcePositionId || input.allocationPositionId, 'sourcePositionId');
    const allocation = findById(this.persistentDomain, RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, 'positionId', sourcePositionId);
    if (!allocation) throw new Error('Allocation position not found.');
    if (!ACCEPTED_STATES.allocation.includes(normalizedState('allocation', allocation))) throw new Error('Allocation position is not allocated.');
    if (settlement.instrumentId && allocation.instrumentId && settlement.instrumentId !== allocation.instrumentId) throw new Error('Settlement and allocation instrument references do not match.');
    if (settlement.listingId && allocation.listingId && settlement.listingId !== allocation.listingId) throw new Error('Settlement and allocation listing references do not match.');
    if (allocation.participantId && allocation.participantId !== ownerId) throw new Error('ownerId must match the allocated participant.');
    if (settlement.participantId && settlement.participantId !== ownerId) throw new Error('ownerId must match the settled participant.');

    const existing = this.persistentDomain.list(RECORD_TYPES.OWNERSHIP_RECOGNITION)
      .find((record) => record.settlementRecordId === settlementRecordId && record.ownerId === ownerId && record.state !== 'SUPERSEDED');
    if (existing) return { ownershipRecognition: existing, created: false };

    const now = new Date().toISOString();
    const ownershipRecognitionId = `OWN-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const payload = {
      ownershipRecognitionId,
      ownerId,
      ownerType: String(input.ownerType || 'PARTICIPANT').toUpperCase(),
      assetId: input.assetId || allocation.assetId || settlement.assetId || null,
      projectId: input.projectId || allocation.projectId || settlement.projectId || null,
      instrumentId: input.instrumentId || allocation.instrumentId || settlement.instrumentId || null,
      listingId: input.listingId || allocation.listingId || settlement.listingId || null,
      commitmentId: input.commitmentId || allocation.commitmentId || null,
      allocationPositionId: sourcePositionId,
      settlementRecordId,
      quantity: Number(input.quantity ?? allocation.quantity ?? allocation.allocatedQuantity ?? settlement.quantity ?? 0),
      unit: input.unit || allocation.unit || allocation.symbol || settlement.unit || null,
      rights: Array.isArray(input.rights) ? input.rights : allocation.rights || [],
      restrictions: Array.isArray(input.restrictions) ? input.restrictions : allocation.restrictions || [],
      recognitionBasis: requireText(input.recognitionBasis || 'SRA_INTERNAL_SETTLEMENT', 'recognitionBasis').toUpperCase(),
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
      state: 'RECOGNIZED',
      recognizedBy: actorId,
      recognizedAt: now,
    };
    payload.ownershipDigest = digest(payload);

    await this.persistentDomain.put(RECORD_TYPES.OWNERSHIP_RECOGNITION, ownershipRecognitionId, payload, {
      actorId,
      eventType: 'OWNERSHIP_RECOGNIZED',
    });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.OWNERSHIP_RECOGNITION,
      objectId: ownershipRecognitionId,
      eventType: 'SRA_OWNERSHIP_RECOGNIZED',
      actorId,
      payload: { ownerId, settlementRecordId, allocationPositionId: sourcePositionId, ownershipDigest: payload.ownershipDigest },
    });

    return { ownershipRecognition: payload, created: true };
  }

  async createExportPackage(input = {}, actorId = 'SRA_PLATFORM') {
    const references = input.references || input;
    const inspection = this.inspect(references);
    if (!inspection.complete) {
      const reasons = [
        inspection.missing.length ? `missing: ${inspection.missing.join(', ')}` : null,
        inspection.issues.length ? `invalid: ${inspection.issues.map((issue) => issue.message).join(' ')}` : null,
      ].filter(Boolean).join('; ');
      throw new Error(`Internal lifecycle is incomplete: ${reasons}.`);
    }

    const existing = this.persistentDomain.list(RECORD_TYPES.EXPORT_PACKAGE)
      .find((record) => record.ownershipRecognitionId === inspection.stages.ownershipRecognition.id && record.state === 'READY_FOR_EXPORT');
    if (existing) return { exportPackage: existing, created: false, inspection };

    const canonicalRecords = {};
    for (const [name, stage] of Object.entries(inspection.stages)) canonicalRecords[name] = stage.record;

    const now = new Date().toISOString();
    const exportPackageId = `EXP-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const manifest = {
      schema: 'SRA_CANONICAL_EXPORT_PACKAGE',
      schemaVersion: 1,
      exportPackageId,
      sourceSystem: 'SRA',
      sourceOfTruth: 'SRA_INTERNAL_LEDGER',
      boundary: 'EXPORT_BOUNDARY',
      lifecycle: [
        'OBSERVE', 'RECOGNIZE', 'FINANCIAL_RECORD', 'COIN_POSITION', 'INSTRUMENT',
        'MARKETPLACE_LISTING', 'PARTICIPATION', 'COMMITMENT', 'ALLOCATION',
        'SETTLEMENT', 'OWNERSHIP_RECOGNITION', 'READY_FOR_EXPORT',
      ],
      references: Object.fromEntries(Object.entries(inspection.stages).map(([name, stage]) => [name, stage.id])),
      records: canonicalRecords,
      destinationClass: input.destinationClass ? String(input.destinationClass).toUpperCase() : 'UNSPECIFIED_ADAPTER',
      adapterInstructions: input.adapterInstructions || {},
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
      generatedBy: actorId,
      generatedAt: now,
    };
    const packageDigest = digest(manifest);
    const exportPackage = {
      exportPackageId,
      ownershipRecognitionId: inspection.stages.ownershipRecognition.id,
      state: 'READY_FOR_EXPORT',
      immutable: true,
      packageDigest,
      manifest,
      createdBy: actorId,
      createdAt: now,
    };

    await this.persistentDomain.put(RECORD_TYPES.EXPORT_PACKAGE, exportPackageId, exportPackage, {
      actorId,
      eventType: 'EXPORT_PACKAGE_CREATED',
    });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.EXPORT_PACKAGE,
      objectId: exportPackageId,
      eventType: 'SRA_ASSET_READY_FOR_EXPORT',
      actorId,
      payload: { packageDigest, destinationClass: manifest.destinationClass, ownershipRecognitionId: inspection.stages.ownershipRecognition.id },
    });

    return { exportPackage, created: true, inspection };
  }

  verifyExportPackage(exportPackageId) {
    const exportPackage = this.getExportPackage(exportPackageId);
    if (!exportPackage) return { valid: false, reason: 'EXPORT_PACKAGE_NOT_FOUND' };
    const calculatedDigest = digest(exportPackage.manifest);
    return {
      valid: exportPackage.immutable === true
        && exportPackage.state === 'READY_FOR_EXPORT'
        && calculatedDigest === exportPackage.packageDigest,
      exportPackageId,
      storedDigest: exportPackage.packageDigest,
      calculatedDigest,
      immutable: exportPackage.immutable === true,
      state: exportPackage.state,
    };
  }

  listExportPackages(filters = {}) {
    return this.persistentDomain.list(RECORD_TYPES.EXPORT_PACKAGE)
      .filter((record) => !filters.state || record.state === filters.state)
      .filter((record) => !filters.destinationClass || record.manifest?.destinationClass === filters.destinationClass)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  getExportPackage(exportPackageId) {
    return this.persistentDomain.get(RECORD_TYPES.EXPORT_PACKAGE, exportPackageId);
  }
}
