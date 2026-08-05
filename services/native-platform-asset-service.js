import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const PLATFORM_ASSET_CODE = 'SRA_PLATFORM_ASSET';
const PLATFORM_OWNER_ID = 'SRA_PLATFORM';

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function money(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${field} must be greater than zero.`);
  return Number(amount.toFixed(2));
}

function getBy(domain, type, field, value) {
  return domain.list(type).find((record) => record?.[field] === value) || null;
}

export class NativePlatformAssetService {
  constructor(domain, internalLifecycle) {
    this.domain = domain;
    this.internalLifecycle = internalLifecycle;
  }

  status() {
    const instrument = getBy(this.domain, RECORD_TYPES.SRA_INSTRUMENT, 'platformAssetCode', PLATFORM_ASSET_CODE);
    if (!instrument) {
      return {
        platformAssetCode: PLATFORM_ASSET_CODE,
        state: 'NOT_CREATED',
        readyForExport: false,
        references: {},
        nextAction: 'ADMIN_APPROVAL_REQUIRED',
      };
    }

    const listing = getBy(this.domain, RECORD_TYPES.MARKETPLACE_LISTING, 'instrumentId', instrument.instrumentId);
    const participation = listing && getBy(this.domain, RECORD_TYPES.PARTICIPATION_POSITION, 'listingId', listing.listingId);
    const commitment = listing && getBy(this.domain, RECORD_TYPES.FUNDING_MARKETPLACE_COMMITMENT, 'listingId', listing.listingId);
    const allocation = commitment && getBy(this.domain, RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, 'commitmentId', commitment.commitmentId);
    const settlement = allocation && getBy(this.domain, RECORD_TYPES.SRA_SETTLEMENT_RECORD, 'allocationPositionId', allocation.positionId);
    const ownership = settlement && getBy(this.domain, RECORD_TYPES.OWNERSHIP_RECOGNITION, 'settlementRecordId', settlement.settlementRecordId);
    const exportPackage = ownership && this.domain.list(RECORD_TYPES.EXPORT_PACKAGE)
      .find((record) => record.ownershipRecognitionId === ownership.ownershipRecognitionId && record.state === 'READY_FOR_EXPORT');

    return {
      platformAssetCode: PLATFORM_ASSET_CODE,
      state: exportPackage ? 'READY_FOR_EXPORT' : 'IN_PROGRESS',
      readyForExport: Boolean(exportPackage),
      references: {
        observationId: instrument.observationId || null,
        recognitionId: instrument.recognitionId || null,
        financialRecordId: instrument.financialRecordId || null,
        coinPositionId: instrument.coinPositionId || null,
        instrumentId: instrument.instrumentId,
        listingId: listing?.listingId || null,
        participationId: participation?.positionId || null,
        commitmentId: commitment?.commitmentId || null,
        allocationId: allocation?.positionId || null,
        settlementRecordId: settlement?.settlementRecordId || null,
        ownershipRecognitionId: ownership?.ownershipRecognitionId || null,
        exportPackageId: exportPackage?.exportPackageId || null,
      },
      nextAction: exportPackage ? 'NONE' : 'ADMIN_APPROVAL_REQUIRED',
    };
  }

  async bootstrap(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    const current = this.status();
    if (current.readyForExport) return { created: false, status: current };

    const issuedAmount = money(input.issuedAmount || 1000000, 'issuedAmount');
    const unitPrice = money(input.unitPrice || 1, 'unitPrice');
    const quantity = Number((issuedAmount / unitPrice).toFixed(8));
    const createdAt = now();

    const observationId = id('OBS');
    const recognitionId = id('REC');
    const financialRecordId = id('FR');
    const coinPositionId = id('CP');
    const instrumentId = id('INS');
    const listingId = id('LIST');
    const participationId = id('PART');
    const commitmentId = id('COM');
    const allocationId = id('ALLOC');
    const settlementRecordId = id('SET');

    const observation = {
      observationId,
      source: 'SRA_PLATFORM_FORMATION',
      subjectId: PLATFORM_ASSET_CODE,
      description: input.description || 'SRA native platform marketplace asset',
      state: 'OBSERVED',
      observedAt: createdAt,
      observedBy: actorId,
    };
    const recognition = {
      recognitionId,
      observationId,
      decision: 'RECOGNIZED',
      recognitionBasis: 'SRA_PLATFORM_FORMATION_RECORD',
      recognizedAt: createdAt,
      recognizedBy: actorId,
    };
    const financialRecord = {
      financialRecordId,
      recognitionId,
      recordType: 'PLATFORM_CAPITAL_ASSET',
      amount: issuedAmount,
      currency: input.currency || 'USD',
      state: 'RECORDED',
      recordedAt: createdAt,
      recordedBy: actorId,
    };
    const coinPosition = {
      coinPositionId,
      financialRecordId,
      assetCode: PLATFORM_ASSET_CODE,
      quantity,
      unitPrice,
      currency: input.currency || 'USD',
      state: 'ACTIVE',
      createdAt,
      createdBy: actorId,
    };
    const instrument = {
      instrumentId,
      platformAssetCode: PLATFORM_ASSET_CODE,
      observationId,
      recognitionId,
      financialRecordId,
      coinPositionId,
      instrumentFamily: 'ASSET_BACKED_NOTE',
      instrumentType: 'PLATFORM_FUNDING_INSTRUMENT',
      issuerId: PLATFORM_OWNER_ID,
      faceAmount: issuedAmount,
      quantity,
      unitPrice,
      currency: input.currency || 'USD',
      rights: ['MARKETPLACE_PARTICIPATION', 'TRANSFER_SUBJECT_TO_PLATFORM_RULES'],
      state: 'ISSUED',
      issuedAt: createdAt,
      issuedBy: actorId,
    };
    const listing = {
      listingId,
      instrumentId,
      sellerId: PLATFORM_OWNER_ID,
      quantity,
      unitPrice,
      currency: input.currency || 'USD',
      marketAccessRule: 'SRA_REGISTERED_PARTICIPANTS',
      transactionRoute: 'SRA_INTERNAL',
      settlementRoute: 'SRA_INTERNAL',
      state: 'PUBLISHED',
      publishedAt: createdAt,
      publishedBy: actorId,
    };
    const participation = {
      positionId: participationId,
      listingId,
      instrumentId,
      participantId: PLATFORM_OWNER_ID,
      quantity,
      state: 'ACTIVE',
      createdAt,
      createdBy: actorId,
    };
    const commitment = {
      commitmentId,
      listingId,
      instrumentId,
      participantId: PLATFORM_OWNER_ID,
      quantity,
      amount: issuedAmount,
      state: 'COMMITTED',
      committedAt: createdAt,
      committedBy: actorId,
    };
    const allocation = {
      positionId: allocationId,
      commitmentId,
      listingId,
      instrumentId,
      participantId: PLATFORM_OWNER_ID,
      quantity,
      allocatedQuantity: quantity,
      amount: issuedAmount,
      state: 'ALLOCATED',
      allocatedAt: createdAt,
      allocatedBy: actorId,
    };
    const settlement = {
      settlementRecordId,
      allocationPositionId: allocationId,
      commitmentId,
      listingId,
      instrumentId,
      participantId: PLATFORM_OWNER_ID,
      quantity,
      amount: issuedAmount,
      route: 'SRA_INTERNAL',
      state: 'SETTLED',
      settledAt: createdAt,
      settledBy: actorId,
    };

    const writes = [
      [RECORD_TYPES.MARKET_OBSERVATION, observationId, observation, 'SRA_PLATFORM_ASSET_OBSERVED'],
      [RECORD_TYPES.RECOGNITION_ASSESSMENT, recognitionId, recognition, 'SRA_PLATFORM_ASSET_RECOGNIZED'],
      [RECORD_TYPES.FINANCIAL_RECORD, financialRecordId, financialRecord, 'SRA_PLATFORM_FINANCIAL_RECORD_CREATED'],
      [RECORD_TYPES.COIN_POSITION, coinPositionId, coinPosition, 'SRA_PLATFORM_COIN_POSITION_CREATED'],
      [RECORD_TYPES.SRA_INSTRUMENT, instrumentId, instrument, 'SRA_PLATFORM_INSTRUMENT_ISSUED'],
      [RECORD_TYPES.MARKETPLACE_LISTING, listingId, listing, 'SRA_PLATFORM_ASSET_LISTED'],
      [RECORD_TYPES.PARTICIPATION_POSITION, participationId, participation, 'SRA_PLATFORM_PARTICIPATION_OPENED'],
      [RECORD_TYPES.FUNDING_MARKETPLACE_COMMITMENT, commitmentId, commitment, 'SRA_PLATFORM_COMMITMENT_RECORDED'],
      [RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, allocationId, allocation, 'SRA_PLATFORM_ALLOCATION_RECORDED'],
      [RECORD_TYPES.SRA_SETTLEMENT_RECORD, settlementRecordId, settlement, 'SRA_PLATFORM_SETTLEMENT_COMPLETED'],
    ];

    for (const [type, recordId, record, eventType] of writes) {
      await this.domain.put(type, recordId, record, { actorId, eventType });
    }

    const ownershipResult = await this.internalLifecycle.recognizeOwnership({
      settlementRecordId,
      sourcePositionId: allocationId,
      ownerId: PLATFORM_OWNER_ID,
      ownerType: 'PLATFORM',
      quantity,
      unit: PLATFORM_ASSET_CODE,
      recognitionBasis: 'SRA_NATIVE_PLATFORM_ASSET_BOOTSTRAP',
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
    }, actorId);

    const exportResult = await this.internalLifecycle.createExportPackage({
      references: {
        observationId,
        recognitionId,
        financialRecordId,
        coinPositionId,
        instrumentId,
        listingId,
        participationId,
        commitmentId,
        allocationId,
        settlementId: settlementRecordId,
        ownershipRecognitionId: ownershipResult.ownershipRecognition.ownershipRecognitionId,
      },
      destinationClass: 'MULTI_RAIL_ADAPTER_READY',
      adapterInstructions: {
        supportedTargets: ['SOLANA', 'ACH', 'FEDWIRE', 'BANK', 'INSTITUTION', 'PARTNER'],
        executionRequired: false,
      },
      evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
    }, actorId);

    await this.domain.lifecycle({
      objectType: RECORD_TYPES.SRA_INSTRUMENT,
      objectId: instrumentId,
      eventType: 'SRA_NATIVE_PLATFORM_ASSET_BOOTSTRAPPED',
      actorId,
      payload: {
        platformAssetCode: PLATFORM_ASSET_CODE,
        listingId,
        ownershipRecognitionId: ownershipResult.ownershipRecognition.ownershipRecognitionId,
        exportPackageId: exportResult.exportPackage.exportPackageId,
      },
    });

    return {
      created: true,
      status: this.status(),
      instrument,
      listing,
      ownershipRecognition: ownershipResult.ownershipRecognition,
      exportPackage: exportResult.exportPackage,
    };
  }
}

export { PLATFORM_ASSET_CODE, PLATFORM_OWNER_ID };
