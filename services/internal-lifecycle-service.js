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
    return {
      boundary: 'SRA_INTERNAL',
      complete: missing.length === 0,
      missing,
      stages
    };
  }

  async recognizeOwnership(input = {}, actorId = 'SRA_PLATFORM') {
    const settlementRecordId = requireText(input.settlementRecordId, 'settlementRecordId');
    const settlement = findById(this.persistentDomain, RECORD_TYPES.SRA_SETTLEMENT_RECORD, 'settlementRecordId', settlementRecordId);
    if (!settlement) throw new Error('Settlement record not found.');

    const ownerId = requireText(input.ownerId, 'ownerId');
    const sourcePositionId = requireText(input.sourcePositionId || input.allocationPositionId, 'sourcePositionId');
    const allocation = findById(this.persistentDomain, RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, 'positionId', sourcePositionId);
    if (!allocation) throw new Error('Allocation position not found.');

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
      listingId: input.listingId || allocation.listingId || null,
      commitmentId: input.commitmentId || allocation.commitmentId || null,
      allocationPositionId: sourcePositionId,
      settlementRecordId,
      quantity: Number(input.quantity ?? allocation.quantity ?? allocation.allocatedQuantity ?? 0),
      unit: input.unit || allocation.unit || allocation.symbol || null,
      rights: Array.isArray(input.rights) ? input.rights : allocation.rights || [],
      restrictions: Array.isArray(input.restrictions) ? input.restrictions : allocation.restrictions || [],
      recognitionBasis: requireText(input.recognitionBasis || 'SRA_INTERNAL_SETTLEMENT', 'recognitionBasis').toUpperCase(),
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
      state: 'RECOGNIZED',
      recognizedBy: actorId,
      recognizedAt: now
    };
    payload.ownershipDigest = digest(payload);

    await this.persistentDomain.put(RECORD_TYPES.OWNERSHIP_RECOGNITION, ownershipRecognitionId, payload, {
      actorId,
      eventType: 'OWNERSHIP_RECOGNIZED'
    });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.OWNERSHIP_RECOGNITION,
      objectId: ownershipRecognitionId,
      eventType: 'SRA_OWNERSHIP_RECOGNIZED',
      actorId,
      payload: { ownerId, settlementRecordId, allocationPositionId: sourcePositionId, ownershipDigest: payload.ownershipDigest }
    });

    return { ownershipRecognition: payload, created: true };
  }

  async createExportPackage(input = {}, actorId = 'SRA_PLATFORM') {
    const references = input.references || input;
    const inspection = this.inspect(references);
    if (!inspection.complete) {
      throw new Error(`Internal lifecycle is incomplete: ${inspection.missing.join(', ')}.`);
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
        'SETTLEMENT', 'OWNERSHIP_RECOGNITION', 'READY_FOR_EXPORT'
      ],
      references: Object.fromEntries(Object.entries(inspection.stages).map(([name, stage]) => [name, stage.id])),
      records: canonicalRecords,
      destinationClass: input.destinationClass ? String(input.destinationClass).toUpperCase() : 'UNSPECIFIED_ADAPTER',
      adapterInstructions: input.adapterInstructions || {},
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
      generatedBy: actorId,
      generatedAt: now
    };
    const packageDigest = digest(manifest);
    const exportPackage = {
      exportPackageId,
      state: 'READY_FOR_EXPORT',
      immutable: true,
      packageDigest,
      manifest,
      createdBy: actorId,
      createdAt: now
    };

    await this.persistentDomain.put(RECORD_TYPES.EXPORT_PACKAGE, exportPackageId, exportPackage, {
      actorId,
      eventType: 'EXPORT_PACKAGE_CREATED'
    });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.EXPORT_PACKAGE,
      objectId: exportPackageId,
      eventType: 'SRA_ASSET_READY_FOR_EXPORT',
      actorId,
      payload: { packageDigest, destinationClass: manifest.destinationClass, ownershipRecognitionId: inspection.stages.ownershipRecognition.id }
    });

    return { exportPackage, created: true, inspection };
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
