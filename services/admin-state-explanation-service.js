import { explainSraAdministrativeState } from './admin-state-explanation-implementation.js';

const TYPES = Object.freeze({
  INSTRUMENT: 'SRA_INSTRUMENT',
  LISTING: 'MARKETPLACE_LISTING',
  PARTICIPATION: 'PARTICIPATION_POSITION',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  ALLOCATION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT: 'SRA_SETTLEMENT_RECORD',
  OWNERSHIP: 'OWNERSHIP_RECOGNITION',
  EXPORT: 'EXPORT_PACKAGE',
});

function by(domain, type, field, value) {
  return domain.list(type).find((record) => record?.[field] === value) || null;
}

function nativePlatformAssetExplanation(domain, question) {
  const normalized = String(question || '').toLowerCase();
  if (!/(native platform asset|sra platform asset|platform asset)/.test(normalized)) return null;

  const instrument = domain.list(TYPES.INSTRUMENT)
    .find((record) => record?.platformAssetCode === 'SRA_PLATFORM_ASSET') || null;

  if (!instrument) {
    return {
      intent: 'NATIVE_PLATFORM_ASSET_STATUS',
      questionKind: 'NATIVE_PLATFORM_ASSET_STATUS',
      subject: { kind: 'ASSET', reference: 'SRA_PLATFORM_ASSET', title: 'SRA native platform asset' },
      answer: 'The SRA native platform asset has not been created. It is waiting at the administrator approval boundary.',
      summary: 'The SRA native platform asset has not been created.',
      status: 'NOT_CREATED',
      facts: [],
      blockers: [{ code: 'ADMIN_APPROVAL_REQUIRED', message: 'Administrator approval is required to create and publish the native platform asset.', source: 'SRA native platform asset workflow' }],
      lifecycle: [], relationships: [], pendingActions: [], simulation: null, references: [],
      nextAction: { stage: 'instrument', label: 'Approve creation and publication of the SRA native platform asset.', authority: 'ADMIN_APPROVAL_REQUIRED', autonomous: false },
    };
  }

  const listing = by(domain, TYPES.LISTING, 'instrumentId', instrument.instrumentId);
  const participation = listing && by(domain, TYPES.PARTICIPATION, 'listingId', listing.listingId);
  const commitment = listing && by(domain, TYPES.COMMITMENT, 'listingId', listing.listingId);
  const allocation = commitment && by(domain, TYPES.ALLOCATION, 'commitmentId', commitment.commitmentId);
  const settlement = allocation && by(domain, TYPES.SETTLEMENT, 'allocationPositionId', allocation.positionId);
  const ownership = settlement && by(domain, TYPES.OWNERSHIP, 'settlementRecordId', settlement.settlementRecordId);
  const exportPackage = ownership && domain.list(TYPES.EXPORT)
    .find((record) => record?.ownershipRecognitionId === ownership.ownershipRecognitionId && record?.state === 'READY_FOR_EXPORT');

  const lifecycle = [
    ['instrument', instrument?.instrumentId, instrument?.state],
    ['listing', listing?.listingId, listing?.state],
    ['participation', participation?.positionId, participation?.state],
    ['commitment', commitment?.commitmentId, commitment?.state],
    ['allocation', allocation?.positionId, allocation?.state],
    ['settlement', settlement?.settlementRecordId, settlement?.state],
    ['ownershipRecognition', ownership?.ownershipRecognitionId, ownership?.state],
    ['exportPackage', exportPackage?.exportPackageId, exportPackage?.state],
  ].map(([stage, recordId, state], index) => ({ sequence: index + 1, stage, recordId: recordId || null, state: state || 'NOT_RECORDED' }));

  const ready = Boolean(exportPackage);
  return {
    intent: 'NATIVE_PLATFORM_ASSET_STATUS',
    questionKind: 'NATIVE_PLATFORM_ASSET_STATUS',
    subject: { kind: 'ASSET', reference: 'SRA_PLATFORM_ASSET', title: 'SRA native platform asset' },
    answer: ready
      ? `The SRA native platform asset is live. Instrument ${instrument.instrumentId} is published through listing ${listing?.listingId}, internally settled, ownership-recognized, and packaged as ${exportPackage.exportPackageId} with READY_FOR_EXPORT status.`
      : `The SRA native platform asset exists as instrument ${instrument.instrumentId}, but its lifecycle is not complete.`,
    summary: ready ? 'The SRA native platform asset is live and ready for export.' : 'The SRA native platform asset is still progressing through its lifecycle.',
    status: ready ? 'READY_FOR_EXPORT' : 'IN_PROGRESS',
    facts: [
      { label: 'Instrument', value: instrument.instrumentId },
      { label: 'Listing', value: listing?.listingId || null },
      { label: 'Export package', value: exportPackage?.exportPackageId || null },
    ],
    blockers: ready ? [] : [{ code: 'LIFECYCLE_INCOMPLETE', message: 'One or more native platform asset lifecycle stages are not recorded.', source: 'SRA native platform asset workflow' }],
    lifecycle,
    relationships: [], pendingActions: [], simulation: null,
    references: lifecycle.filter((item) => item.recordId).map((item) => ({ stage: item.stage, recordId: item.recordId, state: item.state })),
    nextAction: ready ? null : { stage: lifecycle.find((item) => !item.recordId)?.stage || null, label: 'Complete the next governed lifecycle stage.', authority: 'ADMIN_APPROVAL_REQUIRED', autonomous: false },
  };
}

export function explainAdminState(domain, question) {
  return nativePlatformAssetExplanation(domain, question) || explainSraAdministrativeState(domain, question);
}

export { explainSraAdministrativeState };
