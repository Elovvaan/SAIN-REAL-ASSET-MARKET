import { AchSettlementExecutionService } from './ach-settlement-execution-service.js';
import { WireSettlementExecutionService } from './wire-settlement-execution-service.js';
import { RECORD_TYPES } from './persistent-domain-service.js';

const TX = RECORD_TYPES.SRA_TRANSACTION;
const executionLocks = new Map();
const EXECUTED_PROVIDER_STATUSES = new Set(['COMPLETED','EXECUTED','SETTLED','CONFIRMED','SUCCESS','SUCCEEDED']);
const ACCEPTED_PROVIDER_STATUSES = new Set(['ACCEPTED','PENDING','PROCESSING','QUEUED','SUBMITTED','RECEIVED']);
const FAILED_PROVIDER_STATUSES = new Set(['REJECTED','FAILED','CANCELED','CANCELLED','DECLINED','ERROR','RETURNED']);

function classifyProviderStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (EXECUTED_PROVIDER_STATUSES.has(normalized)) return 'EXECUTED';
  if (ACCEPTED_PROVIDER_STATUSES.has(normalized)) return 'ACCEPTED';
  if (FAILED_PROVIDER_STATUSES.has(normalized)) return 'FAILED';
  return 'UNKNOWN';
}

export class TreasuryLiveExecutionService {
  constructor(domain, { achExecutor = new AchSettlementExecutionService(), wireExecutor = new WireSettlementExecutionService() } = {}) {
    this.domain = domain;
    this.achExecutor = achExecutor;
    this.wireExecutor = wireExecutor;
  }

  status() {
    const ach = this.achExecutor.status();
    const wire = this.wireExecutor.status();
    return {
      service: 'TREASURY_PAYMENT_EXECUTION',
      rails: [ach, wire],
      directOnChainExecution: '/api/on-chain',
      liveExecutionEnabled: ach.ready || wire.ready,
    };
  }

  instruction(id) {
    const record = this.domain.get(TX, String(id || '').trim());
    if (!record || record.transactionType !== 'EXTERNAL_TRANSFER_INSTRUCTION') throw new Error('Prepared external transfer instruction was not found.');
    return record;
  }

  async withExecutionLock(transferInstructionId, work) {
    const prior = executionLocks.get(transferInstructionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queued = prior.then(() => current);
    executionLocks.set(transferInstructionId, queued);
    await prior;
    try { return await work(); }
    finally {
      release();
      if (executionLocks.get(transferInstructionId) === queued) executionLocks.delete(transferInstructionId);
    }
  }

  assertAuthorizedInstruction(transferInstructionId, rail) {
    if (!transferInstructionId) throw new Error('transferInstructionId is required.');
    const instruction = this.instruction(transferInstructionId);
    if (String(instruction.route || '').toUpperCase() !== rail) throw new Error(`The payment instruction is not a ${rail} transfer.`);
    const amount = Number(instruction.amountUsd ?? instruction.quantity);
    const currency = String(instruction.currency || 'USD').toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('The authorized payment amount must be greater than zero.');
    if (instruction.state !== 'READY_TO_SEND' || instruction.executionState !== 'AUTHORIZED') throw new Error('The payment instruction is not authorized and ready to send.');
    if (String(instruction.fundsState || '').toUpperCase() !== 'HELD') throw new Error('The payment amount is not reserved against Treasury cash.');
    return { instruction, amount, currency };
  }

  async persistProviderResult(instruction, evidence, actorId, rail) {
    const providerClassification = classifyProviderStatus(evidence.providerStatus);
    if (providerClassification === 'FAILED') {
      const error = new Error(`${rail} provider returned terminal status ${String(evidence.providerStatus).toUpperCase()}.`);
      error.code = `${rail}_PROVIDER_TERMINAL_FAILURE`;
      error.executionEvidence = evidence;
      throw error;
    }
    if (providerClassification === 'UNKNOWN') {
      const error = new Error(`${rail} provider returned unsupported status ${String(evidence.providerStatus || 'UNKNOWN').toUpperCase()}.`);
      error.code = `${rail}_PROVIDER_STATUS_UNRECOGNIZED`;
      error.executionEvidence = evidence;
      throw error;
    }

    const executed = providerClassification === 'EXECUTED';
    const updatedAt = new Date().toISOString();
    const persistedEvidence = {
      rail: evidence.rail,
      requestId: evidence.requestId,
      endpointHost: evidence.endpointHost,
      httpStatus: evidence.httpStatus,
      providerReference: evidence.providerReference,
      providerStatus: evidence.providerStatus,
      requestedAt: evidence.requestedAt,
      payloadHash: evidence.payloadHash,
      responseHash: evidence.responseHash,
    };
    const updatedInstruction = {
      ...instruction,
      state: executed ? 'PROVIDER_EXECUTED' : 'PROVIDER_ACCEPTED',
      executionState: executed ? 'PROVIDER_EXECUTED' : 'PROVIDER_ACCEPTED',
      fundsState: 'SUBMITTED',
      externalWithdrawalState: 'AWAITING_RECEIVING_CONFIRMATION',
      providerReference: evidence.providerReference,
      providerStatus: evidence.providerStatus,
      executionEvidence: persistedEvidence,
      updatedAt,
      statusHistory: [...(instruction.statusHistory || []), {
        state: executed ? 'PROVIDER_EXECUTED' : 'PROVIDER_ACCEPTED', actorId, occurredAt: updatedAt, providerReference: evidence.providerReference,
      }],
    };
    const pkg = instruction.exportPackageId ? this.domain.get(RECORD_TYPES.EXPORT_PACKAGE, instruction.exportPackageId) : null;
    const changes = [{ type: TX, id: instruction.transferInstructionId, payload: updatedInstruction, actorId, eventType: `TREASURY_${rail}_PROVIDER_SUBMITTED` }];
    if (pkg) changes.push({
      type: RECORD_TYPES.EXPORT_PACKAGE,
      id: pkg.exportPackageId,
      payload: { ...pkg, state: updatedInstruction.state, exportExecutionState: updatedInstruction.executionState, providerReference: evidence.providerReference, updatedAt },
      actorId,
      eventType: 'TREASURY_EXPORT_LINEAGE_PROVIDER_SUBMITTED',
    });
    if (typeof this.domain.atomicPut !== 'function') throw new Error('Atomic execution persistence is unavailable.');
    await this.domain.atomicPut(changes);
    return { instruction: updatedInstruction, executionEvidence: persistedEvidence, receivingConfirmationRequired: true, rawBankDetailsStored: false };
  }

  async executeAch(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    const transferInstructionId = String(input.transferInstructionId || '').trim();
    return this.withExecutionLock(transferInstructionId, async () => {
      const { instruction, amount, currency } = this.assertAuthorizedInstruction(transferInstructionId, 'ACH');
      const evidence = await this.achExecutor.execute({
        instructionId: transferInstructionId,
        rail: 'ACH', amount, currency,
        sourceAccountReference: null,
        destination: {
          routingNumber: input.routingNumber,
          accountNumber: input.accountNumber,
          accountType: input.accountType,
          bankName: input.bankName,
        },
        remittanceReference: transferInstructionId,
      }, { actorId });
      return this.persistProviderResult(instruction, evidence, actorId, 'ACH');
    });
  }

  async executeWire(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    const transferInstructionId = String(input.transferInstructionId || '').trim();
    return this.withExecutionLock(transferInstructionId, async () => {
      const { instruction, amount, currency } = this.assertAuthorizedInstruction(transferInstructionId, 'WIRE');
      const evidence = await this.wireExecutor.execute({
        instructionId: transferInstructionId,
        rail: 'WIRE', amount, currency,
        sourceAccountReference: null,
        destination: {
          beneficiaryName: input.beneficiaryName,
          routingNumber: input.routingNumber,
          accountNumber: input.accountNumber,
          bankName: input.bankName,
          beneficiaryAddress: input.beneficiaryAddress,
          bankAddress: input.bankAddress,
          furtherCredit: input.furtherCredit,
        },
        remittanceReference: transferInstructionId,
      }, { actorId });
      return this.persistProviderResult(instruction, evidence, actorId, 'WIRE');
    });
  }

  async reconcile(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    const transferInstructionId = String(input.transferInstructionId || '').trim();
    if (!transferInstructionId) throw new Error('transferInstructionId is required.');
    const instruction = this.instruction(transferInstructionId);
    if (!['PROVIDER_ACCEPTED', 'PROVIDER_EXECUTED'].includes(instruction.state)) throw new Error('The payment has not reached a provider-confirmed state.');
    const receivingConfirmationReference = String(input.receivingConfirmationReference || '').trim();
    if (!receivingConfirmationReference) throw new Error('receivingConfirmationReference is required.');
    const confirmedAmount = Number(input.confirmedAmount ?? instruction.amountUsd ?? instruction.quantity);
    if (confirmedAmount !== Number(instruction.amountUsd ?? instruction.quantity)) throw new Error('Confirmed amount does not match the payment instruction.');
    const updatedAt = new Date().toISOString();
    const updatedInstruction = {
      ...instruction,
      state: 'RECONCILED', executionState: 'RECONCILED', fundsState: 'SETTLED', externalWithdrawalState: 'COMPLETED',
      receivingConfirmationReference, confirmedAmount, reconciledAt: updatedAt,
      accountingState: instruction.accountingState || 'PENDING_CLASSIFICATION', updatedAt,
      statusHistory: [...(instruction.statusHistory || []), { state: 'RECONCILED', actorId, occurredAt: updatedAt, receivingConfirmationReference }],
    };
    const pkg = instruction.exportPackageId ? this.domain.get(RECORD_TYPES.EXPORT_PACKAGE, instruction.exportPackageId) : null;
    const changes = [{ type: TX, id: transferInstructionId, payload: updatedInstruction, actorId, eventType: 'TREASURY_PAYMENT_RECONCILED' }];
    if (pkg) changes.push({
      type: RECORD_TYPES.EXPORT_PACKAGE,
      id: pkg.exportPackageId,
      payload: { ...pkg, state: 'RECONCILED', exportExecutionState: 'RECONCILED', receivingConfirmationReference, updatedAt },
      actorId,
      eventType: 'TREASURY_EXPORT_LINEAGE_RECONCILED',
    });
    await this.domain.atomicPut(changes);
    return { instruction: updatedInstruction, accountingClassificationRequired: updatedInstruction.accountingState === 'PENDING_CLASSIFICATION' };
  }
}

export { classifyProviderStatus };
