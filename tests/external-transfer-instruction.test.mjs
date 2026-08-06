import assert from 'node:assert/strict';
import test from 'node:test';
import { ExternalTransferInstructionService } from '../services/external-transfer-instruction-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.failAtomic = false; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, record) { this.records.set(this.key(type, id), structuredClone(record)); return record; }
  async atomicPut(changes) { if (this.failAtomic) throw new Error('atomic failure'); for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload)); return changes; }
}

async function seed(domain) {
  await domain.put('EXPORT_PACKAGE', 'EXP-1', { exportPackageId: 'EXP-1', participantId: 'BUYER-1', instrumentId: 'INS-1', positionId: 'CP-1', quantity: 25, unit: 'SRA', state: 'READY_FOR_EXPORT', exportExecutionState: 'NOT_STARTED' });
  await domain.put('CUSTODY_DESTINATION', 'DEST-1', { destinationId: 'DEST-1', participantId: 'BUYER-1', route: 'SRA_CUSTODY_NETWORK', address: 'acct-001', supportedUnits: ['SRA'], state: 'ACTIVE' });
}

test('verified destination creates a non-executable transfer instruction atomically', async () => {
  const domain = new MemoryDomain(); await seed(domain);
  const service = new ExternalTransferInstructionService(domain);
  const preview = service.preview({ exportPackageId: 'EXP-1', destinationId: 'DEST-1' });
  assert.equal(preview.state, 'ELIGIBLE_FOR_TRANSFER_INSTRUCTION');
  const instruction = await service.approve({ exportPackageId: 'EXP-1', destinationId: 'DEST-1', approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(instruction.state, 'TRANSFER_INSTRUCTION_VERIFIED');
  assert.equal(instruction.executionState, 'NOT_AUTHORIZED');
  assert.equal(instruction.externalWithdrawalState, 'DISABLED');
  assert.equal(domain.get('EXPORT_PACKAGE', 'EXP-1').exportExecutionState, 'AWAITING_EXECUTION_AUTHORIZATION');
});

test('wrong owner, restricted destination, unsupported unit, and duplicate instruction are rejected', async () => {
  const domain = new MemoryDomain(); await seed(domain);
  const service = new ExternalTransferInstructionService(domain);
  await domain.put('CUSTODY_DESTINATION', 'DEST-2', { participantId: 'OTHER', route: 'R', address: 'A', supportedUnits: ['SRA'] });
  assert.throws(() => service.preview({ exportPackageId: 'EXP-1', destinationId: 'DEST-2' }), /not owned/);
  await domain.put('CUSTODY_DESTINATION', 'DEST-3', { participantId: 'BUYER-1', route: 'R', address: 'A', supportedUnits: ['SRA'], frozen: true });
  assert.throws(() => service.preview({ exportPackageId: 'EXP-1', destinationId: 'DEST-3' }), /restricted/);
  await domain.put('CUSTODY_DESTINATION', 'DEST-4', { participantId: 'BUYER-1', route: 'R', address: 'A', supportedUnits: ['USD'] });
  assert.throws(() => service.preview({ exportPackageId: 'EXP-1', destinationId: 'DEST-4' }), /does not support/);
  await service.approve({ exportPackageId: 'EXP-1', destinationId: 'DEST-1', approval: 'APPROVE' }, 'ADMIN-1');
  await assert.rejects(() => service.approve({ exportPackageId: 'EXP-1', destinationId: 'DEST-1', approval: 'APPROVE' }, 'ADMIN-1'), /not awaiting|already has/);
});

test('atomic failure leaves package unchanged and creates no instruction', async () => {
  const domain = new MemoryDomain(); await seed(domain); domain.failAtomic = true;
  const service = new ExternalTransferInstructionService(domain);
  await assert.rejects(() => service.approve({ exportPackageId: 'EXP-1', destinationId: 'DEST-1', approval: 'APPROVE' }, 'ADMIN-1'), /atomic failure/);
  assert.equal(domain.get('EXPORT_PACKAGE', 'EXP-1').state, 'READY_FOR_EXPORT');
  assert.equal(domain.get('SRA_TRANSACTION', 'XFR-1'), null);
});
