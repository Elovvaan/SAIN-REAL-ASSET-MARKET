const TRANSACTION_TYPE = 'SRA_TRANSACTION';
const exportLocks = new Map();

function now() { return new Date().toISOString(); }
function exportId(settlementId) { return `EXP-${String(settlementId).replace(/^STL-/, '')}`; }
function blocked(record) {
  return Boolean(record?.transferRestricted || record?.exportRestricted || record?.frozen || record?.status === 'FROZEN'
    || record?.state === 'FROZEN' || record?.complianceHold === true || record?.disputeState === 'OPEN');
}

export class PostSettlementExportService {
  constructor(domain) { this.domain = domain; }

  settlement(settlementId) {
    const settlement = this.domain.get(TRANSACTION_TYPE, settlementId);
    if (!settlement || settlement.transactionType !== 'ATOMIC_ORDER_SETTLEMENT') throw new Error('Settled transaction was not found.');
    if (settlement.state !== 'SETTLED' || settlement.settlementState !== 'SETTLED') throw new Error('Transaction is not settled.');
    return settlement;
  }

  preview(input = {}) {
    const settlement = this.settlement(String(input.settlementId || '').trim());
    const position = this.domain.get('COIN_POSITION', settlement.buyerPositionId);
    const ownership = this.domain.get('OWNERSHIP_RECOGNITION', settlement.ownershipRecognitionId);
    const instrument = this.domain.get('SRA_INSTRUMENT', settlement.instrumentId);
    if (!position) throw new Error('Settled buyer position was not found.');
    if (!ownership || ownership.state !== 'RECOGNIZED') throw new Error('Recognized buyer ownership was not found.');
    if (!instrument) throw new Error('Underlying SRA instrument was not found.');
    if (position.participantId !== settlement.buyerParticipantId || ownership.participantId !== settlement.buyerParticipantId) throw new Error('Settlement, position, and ownership participant records do not agree.');
    if (position.instrumentId !== settlement.instrumentId || ownership.instrumentId !== settlement.instrumentId) throw new Error('Settlement, position, and ownership instrument records do not agree.');
    if (Number(position.availableQuantity) < Number(settlement.quantity)) throw new Error('Settled position no longer contains the settled quantity.');

    const blockers = [];
    if (blocked(position)) blockers.push('POSITION_RESTRICTED');
    if (blocked(ownership)) blockers.push('OWNERSHIP_RESTRICTED');
    if (blocked(instrument)) blockers.push('INSTRUMENT_RESTRICTED');
    if (settlement.exportPackageId || this.domain.get('EXPORT_PACKAGE', exportId(settlement.settlementId || settlement.transactionId))) blockers.push('EXPORT_ALREADY_CREATED');

    return {
      action: 'POST_SETTLEMENT_EXPORT_PREVIEW', readOnly: true,
      settlementId: settlement.settlementId || settlement.transactionId,
      positionId: settlement.buyerPositionId,
      ownershipRecognitionId: settlement.ownershipRecognitionId,
      instrumentId: settlement.instrumentId,
      participantId: settlement.buyerParticipantId,
      quantity: Number(settlement.quantity), unit: 'SRA',
      eligibilityState: blockers.length ? 'BLOCKED' : 'ELIGIBLE_FOR_EXPORT_AUTHORIZATION',
      blockers,
      effect: 'Create a governed export package containing the settled position, recognized ownership, instrument identity, and settlement lineage.',
      doesNot: ['MOVE_POSITION_OFF_PLATFORM', 'ENABLE_EXTERNAL_WITHDRAWAL', 'CHANGE_OWNERSHIP', 'CREATE_NEW_VALUE'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit export authorization is required.');
    const settlementId = String(input.settlementId || '').trim();
    if (!settlementId) throw new Error('settlementId is required.');
    const prior = exportLocks.get(settlementId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    exportLocks.set(settlementId, prior.then(() => current));
    await prior;
    try {
      const preview = this.preview(input);
      if (preview.blockers.length) throw new Error(`Export is blocked: ${preview.blockers.join(', ')}.`);
      const settlement = this.settlement(settlementId);
      const position = this.domain.get('COIN_POSITION', preview.positionId);
      const ownership = this.domain.get('OWNERSHIP_RECOGNITION', preview.ownershipRecognitionId);
      const instrument = this.domain.get('SRA_INSTRUMENT', preview.instrumentId);
      const createdAt = now();
      const eid = exportId(settlementId);
      const exportPackage = {
        exportPackageId: eid,
        settlementId,
        positionId: preview.positionId,
        ownershipRecognitionId: preview.ownershipRecognitionId,
        instrumentId: preview.instrumentId,
        participantId: preview.participantId,
        quantity: preview.quantity,
        unit: preview.unit,
        state: 'READY_FOR_EXPORT',
        exportExecutionState: 'NOT_STARTED',
        externalWithdrawalState: 'DISABLED',
        lineage: {
          matchReviewId: settlement.matchReviewId,
          reservationId: settlement.reservationId,
          allocationId: settlement.allocationId,
          settlementId,
        },
        snapshots: { position, ownership, instrument },
        authorizedBy: actorId,
        authorizedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        statusHistory: [{ state: 'READY_FOR_EXPORT', actorId, occurredAt: createdAt }],
      };
      const updatedSettlement = { ...settlement, exportPackageId: eid, exportState: 'READY_FOR_EXPORT', updatedAt: createdAt };
      const updatedPosition = { ...position, exportPackageId: eid, exportState: 'READY_FOR_EXPORT', servicingState: 'ACTIVE', updatedAt: createdAt };
      const updatedOwnership = { ...ownership, exportPackageId: eid, exportState: 'READY_FOR_EXPORT', updatedAt: createdAt };
      if (typeof this.domain.atomicPut !== 'function') throw new Error('Atomic export persistence is unavailable.');
      await this.domain.atomicPut([
        { type: 'EXPORT_PACKAGE', id: eid, payload: exportPackage, actorId, eventType: 'EXPORT_PACKAGE_AUTHORIZED' },
        { type: TRANSACTION_TYPE, id: settlementId, payload: updatedSettlement, actorId, eventType: 'SETTLEMENT_MARKED_EXPORT_READY' },
        { type: 'COIN_POSITION', id: preview.positionId, payload: updatedPosition, actorId, eventType: 'POSITION_MARKED_EXPORT_READY' },
        { type: 'OWNERSHIP_RECOGNITION', id: preview.ownershipRecognitionId, payload: updatedOwnership, actorId, eventType: 'OWNERSHIP_MARKED_EXPORT_READY' },
      ]);
      return exportPackage;
    } finally {
      release();
      exportLocks.delete(settlementId);
    }
  }

  list() { return this.domain.list('EXPORT_PACKAGE').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  status() {
    const packages = this.list();
    return {
      exportPackageCount: packages.length,
      readyForExport: packages.filter((item) => item.state === 'READY_FOR_EXPORT').length,
      externallyExecuted: packages.filter((item) => item.exportExecutionState === 'COMPLETED').length,
      latestExportPackage: packages[0] || null,
    };
  }
}
