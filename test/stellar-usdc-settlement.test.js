import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementRailGatewayService } from '../services/settlement-rail-gateway-service.js';
import { StellarUsdcSettlementService } from '../services/stellar-usdc-settlement-service.js';
import { STELLAR_USDC } from '../services/stellar-transfer-service.js';

class Domain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { const prefix = `${type}:`; return [...this.records].filter(([key]) => key.startsWith(prefix)).map(([, record]) => record); }
  async put(type, id, record) { this.records.set(this.key(type, id), record); return record; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type, change.id, change.payload); }
  async lifecycle(event) { this.events.push(event); }
}

function seedExport(domain) {
  const record = { exportPackageId:'EXP-USDC-1', exportKind:'FINANCING_DISBURSEMENT', state:'READY_FOR_SETTLEMENT_INSTRUCTION', amount:79456.17, currency:'USD', beneficiaryName:'Young Volkswagen of Layton', financingTransactionId:'LFA-USDC-1', closingId:'FCL-USDC-1', disbursementId:'DIS-USDC-1', instrumentId:'INS-USDC-1', statusHistory:[] };
  domain.records.set(domain.key('EXPORT_PACKAGE', record.exportPackageId), record);
  return record;
}

test('gateway creates an exclusive Circle-issued Stellar USDC financing instruction', async () => {
  const domain = new Domain();
  const pkg = seedExport(domain);
  const gateway = new SettlementRailGatewayService(domain, null, null);
  const instruction = await gateway.createInstruction({ exportPackageId:pkg.exportPackageId, rail:'STELLAR_USDC', receivingAccountReference:'GDEALERACCOUNT', destinationMemo:'DEALER-79K', beneficiaryName:pkg.beneficiaryName }, 'ADMIN');
  assert.equal(instruction.rail, 'STELLAR_USDC');
  assert.equal(instruction.currency, 'USDC');
  assert.equal(instruction.network, 'STELLAR');
  assert.equal(instruction.networkAssetIssuer, STELLAR_USDC.issuerAddress);
  assert.equal(instruction.messageStandard, 'STELLAR_PAYMENT');
  assert.equal(instruction.executionMode, 'DIRECT_PARTICIPANT');
  assert.equal(instruction.destinationMemo, 'DEALER-79K');
  await assert.rejects(() => gateway.createInstruction({ exportPackageId:pkg.exportPackageId, rail:'ACH', receivingInstitutionReference:'Bank', receivingAccountReference:'1234', routingNumber:'123456789' }, 'ADMIN'), /already uses STELLAR_USDC/);
});

test('confirmed Stellar USDC payment reconciles the rail and records financing settlement', async () => {
  const domain = new Domain();
  const pkg = seedExport(domain);
  const gateway = new SettlementRailGatewayService(domain, null, null);
  const instruction = await gateway.createInstruction({ exportPackageId:pkg.exportPackageId, rail:'STELLAR_USDC', receivingAccountReference:'GDEALERACCOUNT', beneficiaryName:pkg.beneficiaryName }, 'ADMIN');
  const stellar = {
    async health() { return { ready:true, publicNetwork:true }; },
    async recipientStatus(address) { return { address, exists:true, canReceive:true, trustline:true }; },
    async assetBalance() { return { balance:'100000.0000000', trustline:true, account:'GSRA' }; },
    async send(input) { return { ...input, fromAddress:'GSRA', transactionId:'a'.repeat(64), state:'CONFIRMED', confirmation:{ state:'CONFIRMED', transactionId:'a'.repeat(64), ledger:12345 } }; },
  };
  const closingCalls = [];
  const closingService = { async recordSettlement(disbursementId, input) { closingCalls.push({ disbursementId, input }); return { closing:{ status:'FUNDED' } }; } };
  const service = new StellarUsdcSettlementService({ domain, gateway, closingService, stellar });
  await assert.rejects(() => service.execute(instruction.instructionId, {}, 'ADMIN'), /confirmation is required/);
  const result = await service.execute(instruction.instructionId, { confirmMainnetSettlement:true }, 'ADMIN');
  assert.equal(result.instruction.state, 'RECONCILED');
  assert.equal(result.receipt.state, 'CONFIRMED');
  assert.equal(result.receipt.asset, 'USDC');
  assert.equal(result.receipt.issuerAddress, STELLAR_USDC.issuerAddress);
  assert.equal(result.receipt.destinationMemo, null);
  assert.equal(closingCalls[0].disbursementId, 'DIS-USDC-1');
  assert.equal(closingCalls[0].input.externalReference, 'a'.repeat(64));
});

test('USDC settlement blocks missing trustline and insufficient treasury inventory', async () => {
  const domain = new Domain();
  const pkg = seedExport(domain);
  const gateway = new SettlementRailGatewayService(domain, null, null);
  const instruction = await gateway.createInstruction({ exportPackageId:pkg.exportPackageId, rail:'STELLAR_USDC', receivingAccountReference:'GDEALERACCOUNT' }, 'ADMIN');
  const stellar = {
    async health() { return { ready:true, publicNetwork:true }; },
    async recipientStatus(address) { return { address, exists:true, canReceive:false }; },
    async assetBalance() { return { balance:'0', trustline:true }; },
  };
  const service = new StellarUsdcSettlementService({ domain, gateway, stellar });
  await assert.rejects(() => service.execute(instruction.instructionId, { confirmMainnetSettlement:true }, 'ADMIN'), /official Circle USDC trustline/);
  stellar.recipientStatus = async (address) => ({ address, exists:true, canReceive:true });
  await assert.rejects(() => service.execute(instruction.instructionId, { confirmMainnetSettlement:true }, 'ADMIN'), /below the authorized settlement amount/);
});
