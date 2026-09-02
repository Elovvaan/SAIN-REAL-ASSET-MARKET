import { StellarTransferService, STELLAR_USDC } from './stellar-transfer-service.js';

const RAIL = 'STELLAR_USDC';
const TERMINAL = new Set(['RECONCILED', 'CANCELLED', 'REJECTED', 'RETURNED']);

function text(value) { return String(value ?? '').trim(); }

export class StellarUsdcSettlementService {
  constructor({ domain, gateway, closingService = null, stellar = null, sep24 = null } = {}) {
    this.domain = domain;
    this.gateway = gateway;
    this.closingService = closingService;
    this.stellar = stellar || new StellarTransferService({ domain });
    this.sep24 = sep24;
    this.executing = new Set();
  }

  async status() {
    const health = await this.stellar.health();
    if (!health.ready || health.publicNetwork === false) return { rail: RAIL, asset: STELLAR_USDC, ready: false, health, error:health.publicNetwork === false?'Stellar USDC settlement requires Stellar Mainnet.':undefined };
    try {
      const treasury = await this.stellar.assetBalance('USDC');
      return { rail: RAIL, asset: STELLAR_USDC, ready: treasury.trustline && Number(treasury.balance) > 0, health, treasury, sep24:this.sep24?.status() || { configured:false, standard:'SEP-24' } };
    } catch (error) {
      return { rail: RAIL, asset: STELLAR_USDC, ready: false, health, error: text(error?.message || error) };
    }
  }

  recipientStatus(address) { return this.stellar.recipientStatus(address, 'USDC'); }

  async execute(instructionId, input = {}, actorId = null) {
    const instruction = this.gateway.getInstruction(instructionId);
    if (!instruction) throw new Error('Settlement Rail Instruction not found.');
    if (instruction.rail !== RAIL) throw new Error('Settlement instruction is not a Stellar USDC instruction.');
    if (instruction.state === 'RECONCILED') return instruction;
    if (instruction.state !== 'READY') throw new Error(`Stellar USDC execution requires a READY instruction, not ${instruction.state}.`);
    if (input.confirmMainnetSettlement !== true) throw new Error('Explicit Stellar Mainnet USDC settlement confirmation is required.');
    if (this.executing.has(instructionId)) throw new Error('This Stellar USDC settlement is already executing.');

    const duplicate = this.gateway.listInstructions({ exportPackageId: instruction.exportPackageId })
      .find((item) => item.instructionId !== instructionId && !TERMINAL.has(item.state));
    if (duplicate) throw new Error(`Settlement package already has active instruction ${duplicate.instructionId}.`);

    this.executing.add(instructionId);
    try {
      const health = await this.stellar.health();
      if (!health.ready || health.publicNetwork === false) throw new Error('Stellar Mainnet signer accounts must be reachable before USDC settlement.');
      const recipient = await this.recipientStatus(instruction.receivingAccountReference);
      if (!recipient.exists) throw new Error(recipient.error || 'Destination Stellar account was not found.');
      if (!recipient.canReceive) {
        const error = new Error('Destination Stellar account must establish the official Circle USDC trustline before settlement.');
        error.code = 'STELLAR_DESTINATION_TRUSTLINE_REQUIRED';
        throw error;
      }
      const treasury = await this.stellar.assetBalance('USDC');
      if (!treasury.trustline || Number(treasury.balance) < Number(instruction.amount)) {
        const error = new Error(`Stellar USDC treasury balance ${treasury.balance || '0'} is below the authorized settlement amount ${instruction.amount}.`);
        error.code = 'STELLAR_USDC_INSUFFICIENT_BALANCE';
        throw error;
      }

      const transfer = await this.stellar.send({
        transferId: `SETTLEMENT-${instruction.instructionId}`,
        asset: 'USDC',
        amount: String(instruction.amount),
        destinationAddress: instruction.receivingAccountReference,
        memo: instruction.destinationMemo,
      });
      if (transfer.state !== 'CONFIRMED' || transfer.confirmation?.state !== 'CONFIRMED') {
        const error = new Error('Stellar USDC transaction was submitted but not confirmed; settlement remains unreconciled.');
        error.code = 'STELLAR_USDC_NOT_CONFIRMED';
        error.transactionId = transfer.transactionId;
        throw error;
      }

      const reference = transfer.transactionId;
      await this.gateway.transitionInstruction(instructionId, 'DISPATCHED', { note: 'Signed Stellar USDC payment submitted.' }, actorId);
      await this.gateway.transitionInstruction(instructionId, 'ACCEPTED', { institutionTransactionReference: reference, note: 'Stellar accepted the payment transaction.' }, actorId);
      await this.gateway.transitionInstruction(instructionId, 'EXECUTED', { institutionTransactionReference: reference, networkReference: reference, note: `Confirmed in Stellar ledger ${transfer.confirmation.ledger}.` }, actorId);
      const reconciled = await this.gateway.transitionInstruction(instructionId, 'RECONCILED', { institutionTransactionReference: reference, networkReference: reference, receivingConfirmationReference: reference, confirmedAmount: instruction.amount, note: 'Horizon confirmation reconciled to the financing export package.' }, actorId);

      let closing = null;
      if (instruction.sourceType === 'FINANCING_DISBURSEMENT' && instruction.disbursementId && this.closingService) {
        closing = await this.closingService.recordSettlement(instruction.disbursementId, { externalReference: reference }, actorId);
      }
      const receipt = {
        id: `USDC-RECEIPT-${instructionId}`,
        receiptId: `USDC-RECEIPT-${instructionId}`,
        instructionId,
        exportPackageId: instruction.exportPackageId,
        financingTransactionId: instruction.financingTransactionId,
        beneficiaryName: instruction.beneficiaryName,
        network: 'STELLAR',
        asset: 'USDC',
        issuerAddress: STELLAR_USDC.issuerAddress,
        sourceAddress: transfer.fromAddress,
        destinationAddress: transfer.destinationAddress,
        destinationMemo: instruction.destinationMemo || null,
        amount: Number(instruction.amount),
        transactionId: reference,
        ledger: transfer.confirmation.ledger,
        state: 'CONFIRMED',
        confirmedAt: new Date().toISOString(),
        confirmedBy: actorId,
      };
      await this.domain.put('STELLAR_USDC_SETTLEMENT_RECEIPT', receipt.receiptId, receipt, { actorId, eventType: 'STELLAR_USDC_SETTLEMENT_RECONCILED' });
      return { instruction: reconciled, receipt, closing };
    } finally {
      this.executing.delete(instructionId);
    }
  }
}

export { RAIL as STELLAR_USDC_RAIL };
