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
function transferInstructionId(idempotencyKey) {
  const digest = crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex').slice(0, 24).toUpperCase();
  return `XFR-TRSY-${digest}`;
}
function packageId(instructionId) { return `EXP-${String(instructionId).replace(/^XFR-/, '')}`; }
function blocked(record) {
  return Boolean(record?.frozen || record?.status === 'FROZEN' || record?.state === 'FROZEN'
    || record?.complianceHold || record?.transferRestricted || record?.externalTransferRestricted
    || record?.disputeState === 'OPEN');
}
function fundsHeld(record) {
  return record?.transactionType === 'EXTERNAL_TRANSFER_INSTRUCTION'
    && record?.sourceType === 'PLATFORM_TREASURY_CASH'
    && ['HELD', 'SUBMITTED'].includes(String(record?.fundsState || '').toUpperCase())
    && !['RECONCILED', 'RETURNED', 'CANCELLED', 'FAILED'].includes(String(record?.state || '').toUpperCase());
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
      effect: 'Register a verified ACH destination reference for Treasury payments.',
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
    const heldInstructions = this.domain.list(TX).filter(fundsHeld);
    const reservedUsd = Number(heldInstructions.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0).toFixed(8));
    const availableUsd = Number((Number(summary.cashBalanceUsd || 0) - reservedUsd).toFixed(8));
    if (availableUsd < transferAmount) throw new Error('Treasury cash available for transfer is insufficient.');
    return {
      action: 'TREASURY_PAYMENT_PREVIEW', readOnly: true,
      source: { treasuryProfileId: 'SRA_PLATFORM_TREASURY', accountId: TREASURY_CASH_ACCOUNT_ID, currency: 'USD' },
      destinationId: destination.destinationId,
      destinationLabel: destination.label,
      rail: 'ACH',
      amountUsd: transferAmount,
      treasuryCashBalanceUsd: Number(summary.cashBalanceUsd || 0),
      treasuryReservedUsd: reservedUsd,
      treasuryAvailableUsd: availableUsd,
      state: 'ELIGIBLE_FOR_PAYMENT_AUTHORIZATION',
      effect: 'Authorize one Treasury ACH payment instruction and hold the amount against available Treasury cash.',
      doesNot: ['SUBMIT_TO_ACH_PROVIDER', 'MARK_EXTERNAL_COMPLETION', 'POST_ACCOUNTING_CLASSIFICATION'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator payment authorization is required.');
    const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const instructionId = transferInstructionId(idempotencyKey);
    const key = `${instructionId}:${String(input.destinationId || '')}:${Number(input.amountUsd || 0)}`;
    const prior = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    locks.set(key, prior.then(() => current));
    await prior;
    try {
      const existing = this.domain.get(TX, instructionId);
      if (existing) return { created: false, transferInstruction: existing, paymentInstruction: existing, exportPackage: this.domain.get(RECORD_TYPES.EXPORT_PACKAGE, existing.exportPackageId) };

      const preview = this.preview(input);
      const destination = this.destination(preview.destinationId);
      const createdAt = now();
      const exportPackageId = packageId(instructionId);
      const instruction = {
        transactionId: instructionId,
        transferInstructionId: instructionId,
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
        state: 'READY_TO_SEND',
        executionState: 'AUTHORIZED',
        fundsState: 'HELD',
        externalWithdrawalState: 'AUTHORIZED_FOR_SEND',
        authorizedBy: actorId,
        authorizedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        statusHistory: [{ state: 'READY_TO_SEND', actorId, occurredAt: createdAt }],
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
        transferInstructionId: instructionId,
        authorizationSource: instructionId,
        createdAt,
        updatedAt: createdAt,
        statusHistory: [{ state: 'READY_TO_SEND', actorId, occurredAt: createdAt }],
      };
      await this.domain.atomicPut([
        { type: TX, id: instructionId, payload: instruction, actorId, eventType: 'TREASURY_PAYMENT_AUTHORIZED' },
        { type: RECORD_TYPES.EXPORT_PACKAGE, id: exportPackageId, payload: exportPackage, actorId, eventType: 'TREASURY_PAYMENT_EXPORT_LINEAGE_CREATED' },
      ]);
      return { created: true, transferInstruction: instruction, paymentInstruction: instruction, exportPackage };
    } finally {
      release();
      locks.delete(key);
    }
  }

  list() {
    return this.domain.list(TX)
      .filter((item) => item.transactionType === 'EXTERNAL_TRANSFER_INSTRUCTION' && item.sourceType === 'PLATFORM_TREASURY_CASH')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  status() {
    const transfers = this.list();
    return {
      transferCount: transfers.length,
      readyToSend: transfers.filter((item) => item.state === 'READY_TO_SEND' && item.executionState === 'AUTHORIZED').length,
      reservedUsd: Number(transfers.filter(fundsHeld).reduce((sum, item) => sum + Number(item.amountUsd || 0), 0).toFixed(8)),
      latestTransfer: transfers[0] || null,
      authoritativeRecord: 'EXTERNAL_TRANSFER_INSTRUCTION',
    };
  }
}
