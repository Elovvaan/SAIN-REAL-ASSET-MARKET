import test from 'node:test';
import assert from 'node:assert/strict';
import { AchSettlementExecutionService } from '../services/ach-settlement-execution-service.js';
import { WireSettlementExecutionService } from '../services/wire-settlement-execution-service.js';
import { TreasuryTransferReadinessService } from '../services/treasury-transfer-readiness-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type,id) { return `${type}:${id}`; }
  get(type,id) { return structuredClone(this.records.get(this.key(type,id)) || null); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([,value]) => structuredClone(value));
  }
  async put(type,id,payload) { this.records.set(this.key(type,id), structuredClone(payload)); return structuredClone(payload); }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type,change.id,change.payload); }
}

function response(body) {
  return { ok:true, status:202, headers:{ get:() => null }, text:async() => JSON.stringify(body) };
}

test('ACH executor sends an ACH contract, not a generic destination object', async () => {
  let sent;
  const executor = new AchSettlementExecutionService({
    environment:{ SRA_SETTLEMENT_EXECUTION_MODE:'LIVE', SRA_ACH_ENDPOINT:'https://example.test/ach', SRA_ACH_API_KEY:'key', SRA_ACH_ACCOUNT_ID:'source' },
    fetchImpl:async (_url, options) => { sent = JSON.parse(options.body); return response({ id:'ACH-1', status:'ACCEPTED' }); },
  });
  await executor.execute({
    instructionId:'XFR-ACH-1', rail:'ACH', amount:1, currency:'USD',
    destination:{ routingNumber:'021000021', accountNumber:'12345678', accountType:'CHECKING', bankName:'Bank' },
  });
  assert.equal(sent.ach.routingNumber, '021000021');
  assert.equal(sent.ach.accountType, 'CHECKING');
  assert.equal(sent.wire, undefined);
  assert.equal(executor.status().destinationContract, 'US_BANK_ACCOUNT');
});

test('Wire executor sends a beneficiary wire contract, not ACH fields', async () => {
  let sent;
  const executor = new WireSettlementExecutionService({
    environment:{ SRA_SETTLEMENT_EXECUTION_MODE:'LIVE', SRA_FEDWIRE_ENDPOINT:'https://example.test/wires', SRA_FEDWIRE_API_KEY:'key', SRA_FEDWIRE_ACCOUNT_ID:'source' },
    fetchImpl:async (_url, options) => { sent = JSON.parse(options.body); return response({ id:'WIRE-1', status:'ACCEPTED' }); },
  });
  await executor.execute({
    instructionId:'XFR-WIRE-1', rail:'WIRE', amount:1, currency:'USD',
    destination:{ beneficiaryName:'Recipient', routingNumber:'021000021', accountNumber:'99887766', bankName:'Bank' },
  });
  assert.equal(sent.wire.beneficiaryName, 'Recipient');
  assert.equal(sent.wire.receivingBankRoutingNumber, '021000021');
  assert.equal(sent.ach, undefined);
  assert.equal(executor.status().destinationContract, 'WIRE_BENEFICIARY');
});

test('Treasury readiness preserves wire as a distinct rail', async () => {
  const domain = new MemoryDomain();
  const service = new TreasuryTransferReadinessService(domain, { summary:() => ({ cashBalanceUsd:10 }) });
  const destination = await service.approveDestination({
    approval:'APPROVE', destinationId:'DST-WIRE-TEST', ownerId:'SRA_PLATFORM_TREASURY', label:'Recipient wire', rail:'WIRE', destinationReference:'WIRE-DEST-TEST', verificationState:'VERIFIED',
  }, 'ADMIN');
  const prepared = await service.prepare({ destinationId:destination.destination.destinationId, amountUsd:1, idempotencyKey:'WIRE-ONE' }, 'ADMIN');
  assert.equal(prepared.transferInstruction.route, 'WIRE');
  const authorized = await service.authorizeForExecution(prepared.transferInstruction.transferInstructionId, 'ADMIN');
  assert.equal(authorized.preview.rail, 'WIRE');
  assert.equal(authorized.transferInstruction.route, 'WIRE');
});
