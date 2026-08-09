import test from 'node:test';
import assert from 'node:assert/strict';
import { TreasuryTransferReadinessService } from '../services/treasury-transfer-readiness-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) {
    this.records.set(this.key(type, id), structuredClone(payload));
    return structuredClone(payload);
  }
  async atomicPut(changes) {
    for (const change of changes) await this.put(change.type, change.id, change.payload);
    return changes.map((change) => structuredClone(change.payload));
  }
}

test('ACH preparation records intent without cash while execution authorization enforces cash', async () => {
  const domain = new MemoryDomain();
  let cashBalanceUsd = 0;
  const treasury = { summary: () => ({ cashBalanceUsd }) };
  const service = new TreasuryTransferReadinessService(domain, treasury);

  const destination = await service.approveDestination({
    approval: 'APPROVE',
    destinationId: 'DST-TEST',
    ownerId: 'SRA_PLATFORM_TREASURY',
    label: 'Test bank ••••1234',
    rail: 'ACH',
    destinationReference: 'ACH-DEST-TEST',
    verificationState: 'VERIFIED',
  }, 'ADMIN-1');

  const prepared = await service.prepare({
    destinationId: destination.destination.destinationId,
    amountUsd: 1,
    idempotencyKey: 'ACH-ONE-DOLLAR-TEST',
  }, 'ADMIN-1');

  assert.equal(prepared.transferInstruction.amountUsd, 1);
  assert.equal(prepared.transferInstruction.state, 'PREPARED');
  assert.equal(prepared.transferInstruction.executionState, 'PREPARED');
  assert.equal(prepared.transferInstruction.fundsState, 'UNRESERVED');
  assert.equal(service.status().reservedUsd, 0);

  await assert.rejects(
    service.authorizeForExecution(prepared.transferInstruction.transferInstructionId, 'ADMIN-1'),
    /Treasury cash available for transfer is insufficient/,
  );

  const stillPrepared = domain.get('SRA_TRANSACTION', prepared.transferInstruction.transferInstructionId);
  assert.equal(stillPrepared.state, 'PREPARED');
  assert.equal(stillPrepared.fundsState, 'UNRESERVED');

  cashBalanceUsd = 1;
  const authorized = await service.authorizeForExecution(prepared.transferInstruction.transferInstructionId, 'ADMIN-1');
  assert.equal(authorized.transferInstruction.state, 'READY_TO_SEND');
  assert.equal(authorized.transferInstruction.executionState, 'AUTHORIZED');
  assert.equal(authorized.transferInstruction.fundsState, 'HELD');
  assert.equal(authorized.preview.treasuryAvailableUsd, 1);
  assert.equal(service.status().reservedUsd, 1);
});
