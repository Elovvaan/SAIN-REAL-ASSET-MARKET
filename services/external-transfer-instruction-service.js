const TRANSFER_TYPE = 'SRA_TRANSACTION';
const DESTINATION_TYPES = ['CUSTODY_DESTINATION', 'EXTERNAL_CUSTODY_ACCOUNT', 'TRANSFER_DESTINATION'];
const locks = new Map();

function now() { return new Date().toISOString(); }
function transferId(exportPackageId) { return `XFR-${String(exportPackageId).replace(/^EXP-/, '')}`; }
function ownerId(record) { return record?.participantId || record?.ownerParticipantId || record?.ownerId || record?.accountHolderId || null; }
function blocked(record) { return Boolean(record?.frozen || record?.status === 'FROZEN' || record?.state === 'FROZEN' || record?.complianceHold || record?.transferRestricted || record?.externalTransferRestricted || record?.disputeState === 'OPEN'); }

export class ExternalTransferInstructionService {
  constructor(domain) { this.domain = domain; }

  resolveDestination(id) {
    for (const type of DESTINATION_TYPES) {
      const record = this.domain.get(type, id);
      if (record) return { type, record };
    }
    throw new Error('Transfer destination was not found.');
  }

  exportPackage(exportPackageId) {
    const record = this.domain.get('EXPORT_PACKAGE', exportPackageId);
    if (!record) throw new Error('Export package was not found.');
    if (record.state !== 'READY_FOR_EXPORT' || record.exportExecutionState !== 'NOT_STARTED') throw new Error('Export package is not awaiting transfer instruction.');
    if (record.transferInstructionId || this.domain.get(TRANSFER_TYPE, transferId(exportPackageId))) throw new Error('Export package already has a transfer instruction.');
    return record;
  }

  preview(input = {}) {
    const exportPackageId = String(input.exportPackageId || '').trim();
    const destinationId = String(input.destinationId || '').trim();
    if (!exportPackageId) throw new Error('exportPackageId is required.');
    if (!destinationId) throw new Error('destinationId is required.');
    const pkg = this.exportPackage(exportPackageId);
    const destination = this.resolveDestination(destinationId);
    if (ownerId(destination.record) !== pkg.participantId) throw new Error('Transfer destination is not owned by the export-package participant.');
    if (blocked(destination.record)) throw new Error('Transfer destination is restricted or unavailable.');
    const route = String(destination.record.route || destination.record.network || destination.record.custodyRoute || '').trim();
    const address = String(destination.record.address || destination.record.accountReference || destination.record.destinationReference || '').trim();
    if (!route) throw new Error('Transfer destination does not define a custody route or network.');
    if (!address) throw new Error('Transfer destination does not define an account or address reference.');
    const supportedUnits = destination.record.supportedUnits || destination.record.supportedAssets || ['SRA'];
    if (Array.isArray(supportedUnits) && !supportedUnits.map((item) => String(item).toUpperCase()).includes(String(pkg.unit || 'SRA').toUpperCase())) throw new Error('Transfer destination does not support the exported unit.');
    return {
      action: 'EXTERNAL_TRANSFER_INSTRUCTION_PREVIEW', readOnly: true,
      exportPackageId, destinationId, destinationType: destination.type,
      participantId: pkg.participantId, instrumentId: pkg.instrumentId,
      positionId: pkg.positionId, quantity: Number(pkg.quantity), unit: pkg.unit || 'SRA',
      route, destinationReference: address,
      state: 'ELIGIBLE_FOR_TRANSFER_INSTRUCTION',
      effect: 'Create a verified, non-executable external transfer instruction for separate administrator execution authorization.',
      doesNot: ['MOVE_POSITION', 'CHANGE_OWNERSHIP', 'ENABLE_WITHDRAWAL', 'EXECUTE_EXTERNAL_TRANSFER'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit transfer-instruction approval is required.');
    const exportPackageId = String(input.exportPackageId || '').trim();
    const prior = locks.get(exportPackageId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    locks.set(exportPackageId, prior.then(() => current));
    await prior;
    try {
      const preview = this.preview(input);
      const pkg = this.exportPackage(exportPackageId);
      const createdAt = now();
      const id = transferId(exportPackageId);
      const instruction = {
        transactionId: id, transferInstructionId: id, transactionType: 'EXTERNAL_TRANSFER_INSTRUCTION',
        exportPackageId, destinationId: preview.destinationId, destinationType: preview.destinationType,
        participantId: preview.participantId, instrumentId: preview.instrumentId, positionId: preview.positionId,
        quantity: preview.quantity, unit: preview.unit, route: preview.route,
        destinationReference: preview.destinationReference,
        state: 'TRANSFER_INSTRUCTION_VERIFIED', executionState: 'NOT_AUTHORIZED', externalWithdrawalState: 'DISABLED',
        approvedBy: actorId, approvedAt: createdAt, createdAt, updatedAt: createdAt,
        statusHistory: [{ state: 'TRANSFER_INSTRUCTION_VERIFIED', actorId, occurredAt: createdAt }],
      };
      const updatedPackage = { ...pkg, transferInstructionId: id, state: 'TRANSFER_INSTRUCTION_VERIFIED', exportExecutionState: 'AWAITING_EXECUTION_AUTHORIZATION', updatedAt: createdAt };
      if (typeof this.domain.atomicPut !== 'function') throw new Error('Atomic transfer-instruction persistence is unavailable.');
      await this.domain.atomicPut([
        { type: TRANSFER_TYPE, id, payload: instruction, actorId, eventType: 'EXTERNAL_TRANSFER_INSTRUCTION_APPROVED' },
        { type: 'EXPORT_PACKAGE', id: exportPackageId, payload: updatedPackage, actorId, eventType: 'EXPORT_PACKAGE_TRANSFER_INSTRUCTION_VERIFIED' },
      ]);
      return instruction;
    } finally {
      release();
      locks.delete(exportPackageId);
    }
  }

  list() { return this.domain.list(TRANSFER_TYPE).filter((item) => item.transactionType === 'EXTERNAL_TRANSFER_INSTRUCTION').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  status() { const items = this.list(); return { transferInstructionCount: items.length, awaitingExecutionAuthorization: items.filter((item) => item.executionState === 'NOT_AUTHORIZED').length, executed: items.filter((item) => item.executionState === 'COMPLETED').length, latestTransferInstruction: items[0] || null }; }
}
