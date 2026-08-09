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
        ownerId: null,
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

    let state = 'ISSUED';
    let nextAction = 'PUBLISH_LISTING';
    if (listing) { state = listing.state === 'PUBLISHED' ? 'PUBLISHED' : 'LISTED'; nextAction = 'AWAIT_MARKET_PARTICIPATION'; }
    if (participation) { state = 'PARTICIPATION_ACTIVE'; nextAction = 'AWAIT_COMMITMENT'; }
    if (commitment) { state = 'COMMITTED'; nextAction = 'AWAIT_ALLOCATION'; }
    if (allocation) { state = 'ALLOCATED'; nextAction = 'AWAIT_SETTLEMENT'; }
    if (settlement) { state = 'SETTLED'; nextAction = 'RECOGNIZE_OWNERSHIP'; }
    if (ownership) { state = 'OWNERSHIP_RECOGNIZED'; nextAction = 'PREPARE_EXPORT'; }
    if (exportPackage) { state = 'READY_FOR_EXPORT'; nextAction = 'NONE'; }

    return {
      platformAssetCode: PLATFORM_ASSET_CODE,
      state,
      ownerId: ownership?.ownerId || instrument.ownerId || PLATFORM_OWNER_ID,
      initialOwnerId: instrument.initialOwnerId || PLATFORM_OWNER_ID,
      ownershipState: ownership ? 'TRANSFERRED_AFTER_SETTLEMENT' : (instrument.ownershipState || 'PLATFORM_OWNED'),
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
      nextAction,
    };
  }

  async bootstrap(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    const current = this.status();
    if (current.references.instrumentId) return { created: false, status: current };

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
      ownerId: PLATFORM_OWNER_ID,
      ownerType: 'PLATFORM',
      initialOwnerId: PLATFORM_OWNER_ID,
      ownershipState: 'PLATFORM_OWNED',
      ownershipBasis: 'SRA_PLATFORM_FORMATION_RECORD',
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
      ownerId: PLATFORM_OWNER_ID,
      initialOwnerId: PLATFORM_OWNER_ID,
      ownershipState: 'PLATFORM_OWNED',
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
      sourceOwnerId: PLATFORM_OWNER_ID,
      offeredByOwner: true,
      ownershipTransferMode: 'MARKETPLACE_SETTLEMENT',
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

    const writes = [
      [RECORD_TYPES.MARKET_OBSERVATION, observationId, observation, 'SRA_PLATFORM_ASSET_OBSERVED'],
      [RECORD_TYPES.RECOGNITION_ASSESSMENT, recognitionId, recognition, 'SRA_PLATFORM_ASSET_RECOGNIZED'],
      [RECORD_TYPES.FINANCIAL_RECORD, financialRecordId, financialRecord, 'SRA_PLATFORM_FINANCIAL_RECORD_CREATED'],
      [RECORD_TYPES.COIN_POSITION, coinPositionId, coinPosition, 'SRA_PLATFORM_COIN_POSITION_CREATED'],
      [RECORD_TYPES.SRA_INSTRUMENT, instrumentId, instrument, 'SRA_PLATFORM_INSTRUMENT_ISSUED'],
      [RECORD_TYPES.MARKETPLACE_LISTING, listingId, listing, 'SRA_PLATFORM_ASSET_LISTED'],
    ];

    for (const [type, recordId, record, eventType] of writes) {
      await this.domain.put(type, recordId, record, { actorId, eventType });
    }

    await this.domain.lifecycle({
      objectType: RECORD_TYPES.SRA_INSTRUMENT,
      objectId: instrumentId,
      eventType: 'SRA_NATIVE_PLATFORM_ASSET_CREATED_AND_LISTED',
      actorId,
      payload: {
        platformAssetCode: PLATFORM_ASSET_CODE,
        initialOwnerId: PLATFORM_OWNER_ID,
        ownershipState: 'PLATFORM_OWNED',
        listingId,
      },
    });

    return {
      created: true,
      status: this.status(),
      coinPosition,
      instrument,
      listing,
    };
  }
}

export { PLATFORM_ASSET_CODE, PLATFORM_OWNER_ID };
