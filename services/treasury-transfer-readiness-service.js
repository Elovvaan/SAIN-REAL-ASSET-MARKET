import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { TreasuryLedgerService } from './treasury-ledger-service.js';

const TX = RECORD_TYPES.SRA_TRANSACTION;
const DESTINATION_TYPE = 'TRANSFER_DESTINATION';
const TREASURY_CASH_ACCOUNT_ID = 'TRSY-1000-CASH-USD';
const locks = new Map();

function now() { return new Date().toISOString(); }
function amount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('amountUsd must be greater than zero.');
  return Number(parsed.toFixed(8));
}
function required(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}
function destinationId(input = {}) {
  if (input.destinationId) return required(input.destinationId, 'destinationId');
  return `DST-${crypto.randomUUID().toUpperCase()}`;
}
function packageId() { return `EXP-TRSY-${crypto.randomUUID().toUpperCase()}`; }
function instructionId(exportPackageId) { return `XFR-${String(exportPackageId).replace(/^EXP-/, '')}`; }
function authorizationId(transferInstructionId) { return `XAU-${String(transferInstructionId).replace(/^XFR-/, '')}`; }
function blocked(record) {
  return Boolean(record?.frozen || record?.status === 'FROZEN' || record?.state === 'FROZEN'
    || record?.complianceHold || record?.transferRestricted || record?.externalTransferRestricted
    || record?.disputeState === 'OPEN');
}

export class TreasuryTransferReadinessService {
  constructor(domain, treasury = new TreasuryLedgerService(domain)) {
    this.domain = domain;
    this.treasury = treasury;
  }

  destinations() {
    return this.domain.list(DESTINATION_TYPE)
      .filter((item) => item.purpose === 'TREASURY_EXTERNAL_TRANSFER')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  destination(id) {
    const record = this.domain.get(DESTINATION_TYPE, id);
    if (!record || record.purpose !== 'TREASURY_EXTERNAL_TRANSFER') throw new Error('Treasury transfer destination was not found.');
    return record;
  }

  previewDestination(input = {}) {
    const ownerId = required(input.ownerId, 'ownerId');
    const label = required(input.label, 'label');
    const rail = String(input.rail || 'ACH').trim().toUpperCase();
    if (rail !== 'ACH') throw new Error('Transfer Readiness v1 supports ACH only.');
    const destinationReference = required(input.destinationReference, 'destinationReference');
    const verificationState = String(input.verificationState || 'VERIFIED').trim().toUpperCase();
    if (verificationState !== 'VERIFIED') throw new Error('The destination must be VERIFIED before transfer readiness can be approved.');
    return {
      action: 'TREASURY_TRANSFER_DESTINATION_PREVIEW', readOnly: true,
      destinationId: input.destinationId || null,
      ownerId, label, rail, destinationReference,
      supportedUnits: ['USD'], verificationState,
      purpose: 'TREASURY_EXTERNAL_TRANSFER',
      state: 'ELIGIBLE_FOR_DESTINATION_REGISTRATION',
      effect: 'Register a verified ACH destination reference for a Treasury-originated transfer workflow.',
      approvalRequired: true,
    };
  }

  async approveDestination(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator destination approval is required.');
    const preview = this.previewDestination(input);
    const id = destinationId(input);
    const existing = this.domain.get(DESTINATION_TYPE, id);
    if (existing) return { destination: existing, created: false };
    const createdAt = now();
    const destination = {
      destinationId: id,
      ownerId: preview.ownerId,
      participantId: preview.ownerId,
      label: preview.label,
      purpose: preview.purpose,
      route: preview.rail,
      destinationReference: preview.destinationReference,
      supportedUnits: preview.supportedUnits,
      verificationState: preview.verificationState,
      state: 'ACTIVE',
      createdBy: actorId,
      createdAt,
      updatedAt: createdAt,
    };
    await this.domain.put(DESTINATION_TYPE, id, destination, {
      actorId,
      eventType: 'TREASURY_TRANSFER_DESTINATION_REGISTERED',
    });
    return { destination, created: true };
  }

  preview(input = {}) {
    const transferAmount = amount(input.amountUsd);
    const destination = this.destination(required(input.destinationId, 'destinationId'));
    if (blocked(destination) || destination.state !== 'ACTIVE' || destination.verificationState !== 'VERIFIED') throw new Error('Destination is not verified and available.');
    if (String(destination.route || '').toUpperCase() !== 'ACH') throw new Error('Transfer Readiness v1 requires an ACH destination.');
    const summary = this.treasury.summary();
    const activeReservations = this.domain.list(TX)
      .filter((item) => item.transactionType === 'TREASURY_TRANSFER_RESERVATION' && ['HELD', 'READY_TO_SEND'].includes(item.state));
    const reservedUsd = Number(activeReservations.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0).toFixed(8));
    const availableUsd = Number((Number(summary.cashBalanceUsd || 0) - reservedUsd).toFixed(8));
    if (availableUsd < transferAmount) throw new Error('Treasury cash available for transfer is insufficient.');
    return {
      action: 'TREASURY_TRANSFER_READINESS_PREVIEW', readOnly: true,
      source: { treasuryProfileId: 'SRA_PLATFORM_TREASURY', accountId: TREASURY_CASH_ACCOUNT_ID, currency: 'USD' },
      destinationId: destination.destinationId,
      destinationLabel: destination.label,
      rail: 'ACH',
      amountUsd: transferAmount,
      treasuryCashBalanceUsd: Number(summary.cashBalanceUsd || 0),
      treasuryReservedUsd: reservedUsd,
      treasuryAvailableUsd: availableUsd,
      state: 'ELIGIBLE_FOR_TRANSFER_READINESS',
      effect: 'Create and authorize a Treasury-originated ACH export package and transfer instruction in READY_TO_SEND state while reserving, but not externally moving, the USD amount.',
      doesNot: ['SUBMIT_TO_ACH_PROVIDER', 'MARK_EXTERNAL_COMPLETION', 'POST_FINAL_CASH_REDUCTION'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator transfer-readiness approval is required.');
    const key = `${String(input.destinationId || '')}:${Number(input.amountUsd || 0)}:${String(input.idempotencyKey || '')}`;
    const prior = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    locks.set(key, prior.then(() => current));
    await prior;
    try {
      const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
      const digest = crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24).toUpperCase();
      const reservationId = `TRR-${digest}`;
      const priorReservation = this.domain.get(TX, reservationId);
      if (priorReservation) return { created: false, reservation: priorReservation, exportPackage: this.domain.get(RECORD_TYPES.EXPORT_PACKAGE, priorReservation.exportPackageId), transferInstruction: this.domain.get(TX, priorReservation.transferInstructionId), executionAuthorization: this.domain.get(TX, priorReservation.executionAuthorizationId) };
      const preview = this.preview(input);
      const destination = this.destination(preview.destinationId);
      const createdAt = now();
      const exportPackageId = packageId();
      const transferInstructionId = instructionId(exportPackageId);
      const executionAuthorizationId = authorizationId(transferInstructionId);
      const reservation = {
        transactionId: reservationId,
        reservationId,
        transactionType: 'TREASURY_TRANSFER_RESERVATION',
        treasuryProfileId: 'SRA_PLATFORM_TREASURY',
        sourceAccountId: TREASURY_CASH_ACCOUNT_ID,
        destinationId: destination.destinationId,
        exportPackageId,
        transferInstructionId,
        executionAuthorizationId,
        amountUsd: preview.amountUsd,
        currency: 'USD',
        rail: 'ACH',
        state: 'READY_TO_SEND',
        holdState: 'HELD',
        externalTransferState: 'NOT_SUBMITTED',
        authorizedBy: actorId,
        authorizedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      };
      const exportPackage = {
        exportPackageId,
        sourceType: 'PLATFORM_TREASURY_CASH',
        treasuryProfileId: 'SRA_PLATFORM_TREASURY',
        sourceAccountId: TREASURY_CASH_ACCOUNT_ID,
        participantId: destination.ownerId,
        destinationId: destination.destinationId,
        quantity: preview.amountUsd,
        amountUsd: preview.amountUsd,
        unit: 'USD',
        currency: 'USD',
        route: 'ACH',
        state: 'READY_TO_SEND',
        exportExecutionState: 'AUTHORIZED',
        externalWithdrawalState: 'AUTHORIZED_FOR_OPERATOR',
        treasuryReservationId: reservationId,
        transferInstructionId,
        executionAuthorizationId,
        authorizedBy: actorId,
        authorizedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        statusHistory: [{ state: 'READY_TO_SEND', actorId, occurredAt: createdAt }],
      };
      const instruction = {
        transactionId: transferInstructionId,
        transferInstructionId,
        transactionType: 'EXTERNAL_TRANSFER_INSTRUCTION',
        exportPackageId,
        destinationId: destination.destinationId,
        destinationType: DESTINATION_TYPE,
        participantId: destination.ownerId,
        quantity: preview.amountUsd,
        amountUsd: preview.amountUsd,
        unit: 'USD',
        currency: 'USD',
        route: 'ACH',
        destinationReference: destination.destinationReference,
        sourceType: 'PLATFORM_TREASURY_CASH',
        treasuryProfileId: 'SRA_PLATFORM_TREASURY',
        sourceAccountId: TREASURY_CASH_ACCOUNT_ID,
        treasuryReservationId: reservationId,
        state: 'READY_TO_SEND',
        executionState: 'AUTHORIZED',
        externalWithdrawalState: 'AUTHORIZED_FOR_OPERATOR',
        approvedBy: actorId,
        approvedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        statusHistory: [{ state: 'READY_TO_SEND', actorId, occurredAt: createdAt }],
      };
      const authorization = {
        transactionId: executionAuthorizationId,
        executionAuthorizationId,
        transactionType: 'EXTERNAL_TRANSFER_EXECUTION_AUTHORIZATION',
        transferInstructionId,
        exportPackageId,
        participantId: destination.ownerId,
        quantity: preview.amountUsd,
        amountUsd: preview.amountUsd,
        unit: 'USD',
        currency: 'USD',
        route: 'ACH',
        sourceType: 'PLATFORM_TREASURY_CASH',
        treasuryReservationId: reservationId,
        state: 'READY_TO_SEND',
        executionState: 'AUTHORIZED',
        externalWithdrawalState: 'AUTHORIZED_FOR_OPERATOR',
        authorizedBy: actorId,
        authorizedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      };
      await this.domain.atomicPut([
        { type: TX, id: reservationId, payload: reservation, actorId, eventType: 'TREASURY_TRANSFER_AMOUNT_RESERVED' },
        { type: RECORD_TYPES.EXPORT_PACKAGE, id: exportPackageId, payload: exportPackage, actorId, eventType: 'TREASURY_EXPORT_PACKAGE_READY_TO_SEND' },
        { type: TX, id: transferInstructionId, payload: instruction, actorId, eventType: 'TREASURY_ACH_TRANSFER_INSTRUCTION_READY_TO_SEND' },
        { type: TX, id: executionAuthorizationId, payload: authorization, actorId, eventType: 'TREASURY_ACH_EXECUTION_AUTHORIZED' },
      ]);
      return { created: true, reservation, exportPackage, transferInstruction: instruction, executionAuthorization: authorization };
    } finally {
      release();
      locks.delete(key);
    }
  }

  list() {
    return this.domain.list(TX)
      .filter((item) => item.transactionType === 'TREASURY_TRANSFER_RESERVATION')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  status() {
    const transfers = this.list();
    return {
      transferCount: transfers.length,
      readyToSend: transfers.filter((item) => item.state === 'READY_TO_SEND').length,
      reservedUsd: Number(transfers.filter((item) => ['HELD', 'READY_TO_SEND'].includes(item.state)).reduce((sum, item) => sum + Number(item.amountUsd || 0), 0).toFixed(8)),
      latestTransfer: transfers[0] || null,
    };
  }
}
