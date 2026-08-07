import { SettlementAdapterExecutionService } from './settlement-adapter-execution-service.js';
import { RECORD_TYPES } from './persistent-domain-service.js';

const TX = RECORD_TYPES.SRA_TRANSACTION;
const executionLocks = new Map();
const EXECUTED_PROVIDER_STATUSES = new Set(['COMPLETED','EXECUTED','SETTLED','CONFIRMED','SUCCESS','SUCCEEDED']);
const ACCEPTED_PROVIDER_STATUSES = new Set(['ACCEPTED','PENDING','PROCESSING','QUEUED','SUBMITTED','RECEIVED']);
const FAILED_PROVIDER_STATUSES = new Set(['REJECTED','FAILED','CANCELED','CANCELLED','DECLINED','ERROR','RETURNED']);

function digits(value) { return String(value || '').replace(/\D/g, ''); }
function validRoutingNumber(value) {
  const routing = digits(value);
  if (routing.length !== 9) return false;
  const numbers = [...routing].map(Number);
  const checksum = 3 * (numbers[0] + numbers[3] + numbers[6])
    + 7 * (numbers[1] + numbers[4] + numbers[7])
    + (numbers[2] + numbers[5] + numbers[8]);
  return checksum % 10 === 0;
}
function classifyProviderStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (EXECUTED_PROVIDER_STATUSES.has(normalized)) return 'EXECUTED';
  if (ACCEPTED_PROVIDER_STATUSES.has(normalized)) return 'ACCEPTED';
  if (FAILED_PROVIDER_STATUSES.has(normalized)) return 'FAILED';
  return 'UNKNOWN';
}

export class TreasuryLiveExecutionService {
  constructor(domain, { executor = new SettlementAdapterExecutionService() } = {}) {
    this.domain = domain;
    this.executor = executor;
  }

  status() { return this.executor.status(); }

  instruction(id) {
    const record = this.domain.get(TX, String(id || '').trim());
    if (!record || record.transactionType !== 'EXTERNAL_TRANSFER_INSTRUCTION') throw new Error('Prepared external transfer instruction was not found.');
    return record;
  }

  async executeOneDollarAch(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    const transferInstructionId = String(input.transferInstructionId || '').trim();
    if (!transferInstructionId) throw new Error('transferInstructionId is required.');

    const prior = executionLocks.get(transferInstructionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queued = prior.then(() => current);
    executionLocks.set(transferInstructionId, queued);
    await prior;

    try {
      const instruction = this.instruction(transferInstructionId);
      if (String(instruction.route || '').toUpperCase() !== 'ACH') throw new Error('The one-dollar canary requires an ACH transfer instruction.');
      if (Number(instruction.amountUsd ?? instruction.quantity) !== 1 || String(instruction.currency || 'USD').toUpperCase() !== 'USD') throw new Error('The canary endpoint only executes a prepared 1.00 USD transfer instruction.');
      if (instruction.state !== 'READY_TO_SEND' || instruction.executionState !== 'AUTHORIZED') throw new Error('The transfer instruction is not READY_TO_SEND with execution authorization.');

      const routingNumber = digits(input.routingNumber);
      if (!validRoutingNumber(routingNumber)) throw new Error('A valid 9-digit ACH routing number is required.');
      const accountNumber = digits(input.accountNumber);
      if (accountNumber.length < 4 || accountNumber.length > 17) throw new Error('ACH account number must contain 4 to 17 digits.');
      const accountType = String(input.accountType || '').trim().toUpperCase();
      if (!['CHECKING','SAVINGS'].includes(accountType)) throw new Error('ACH account type must be CHECKING or SAVINGS.');

      const transientInstruction = {
        instructionId: transferInstructionId,
        state: 'READY',
        rail: 'ACH',
        amount: 1,
        currency: 'USD',
        senderAccountReference: null,
        receivingAccountReference: instruction.destinationReference,
        transientDestination: {
          type: 'US_BANK_ACCOUNT',
          routingNumber,
          accountNumber,
          accountType,
          bankName: String(input.bankName || 'ACH destination').trim() || 'ACH destination',
        },
        purpose: 'SRA_TREASURY_ONE_DOLLAR_CANARY',
        remittanceReference: instruction.exportPackageId || transferInstructionId,
        settlementId: instruction.exportPackageId || null,
        settlementPackageId: null,
        commitmentId: null,
        messageHash: null,
      };
      const confirmation = String(input.confirmation || '').trim();
      this.executor.assertCanExecute(transientInstruction, confirmation);
      const evidence = await this.executor.execute(transientInstruction, { confirmation, actorId });
      const providerClassification = classifyProviderStatus(evidence.providerStatus);
      if (providerClassification === 'FAILED') {
        const error = new Error(`ACH provider returned terminal status ${String(evidence.providerStatus).toUpperCase()}.`);
        error.code = 'ACH_PROVIDER_TERMINAL_FAILURE';
        error.executionEvidence = evidence;
        throw error;
      }
      if (providerClassification === 'UNKNOWN') {
        const error = new Error(`ACH provider returned unsupported status ${String(evidence.providerStatus || 'UNKNOWN').toUpperCase()}.`);
        error.code = 'ACH_PROVIDER_STATUS_UNRECOGNIZED';
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
        externalWithdrawalState: 'AWAITING_RECEIVING_CONFIRMATION',
        providerReference: evidence.providerReference,
        providerStatus: evidence.providerStatus,
        executionEvidence: persistedEvidence,
        updatedAt,
        statusHistory: [...(instruction.statusHistory || []), {
          state: executed ? 'PROVIDER_EXECUTED' : 'PROVIDER_ACCEPTED',
          actorId,
          occurredAt: updatedAt,
          providerReference: evidence.providerReference,
        }],
      };
      const pkg = instruction.exportPackageId ? this.domain.get(RECORD_TYPES.EXPORT_PACKAGE, instruction.exportPackageId) : null;
      const changes = [{ type: TX, id: transferInstructionId, payload: updatedInstruction, actorId, eventType: 'TREASURY_ACH_PROVIDER_SUBMITTED' }];
      if (pkg) changes.push({
        type: RECORD_TYPES.EXPORT_PACKAGE,
        id: pkg.exportPackageId,
        payload: { ...pkg, state: updatedInstruction.state, exportExecutionState: updatedInstruction.executionState, providerReference: evidence.providerReference, updatedAt },
        actorId,
        eventType: 'TREASURY_EXPORT_PROVIDER_SUBMITTED',
      });
      if (typeof this.domain.atomicPut !== 'function') throw new Error('Atomic execution persistence is unavailable.');
      await this.domain.atomicPut(changes);
      return {
        canary: true,
        instruction: updatedInstruction,
        executionEvidence: persistedEvidence,
        receivingConfirmationRequired: true,
        rawBankDetailsStored: false,
      };
    } finally {
      release();
      if (executionLocks.get(transferInstructionId) === queued) executionLocks.delete(transferInstructionId);
    }
  }
}

export { validRoutingNumber, classifyProviderStatus };
