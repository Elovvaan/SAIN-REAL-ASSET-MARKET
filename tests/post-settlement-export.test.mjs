import assert from 'node:assert/strict';
import test from 'node:test';
import { PostSettlementExportService } from '../services/post-settlement-export-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.failAtomic = false; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, record) { this.records.set(this.key(type, id), structuredClone(record)); return record; }
  async atomicPut(changes) {
    if (this.failAtomic) throw new Error('atomic failure');
    for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload));
    return changes.map((change) => change.payload);
  }
}

async function seed(domain) {
  await domain.put('SRA_TRANSACTION', 'STL-1', {
    transactionId: 'STL-1', settlementId: 'STL-1', transactionType: 'ATOMIC_ORDER_SETTLEMENT',
    state: 'SETTLED', settlementState: 'SETTLED', instrumentId: 'INS-1', buyerParticipantId: 'BUYER-1',
    buyerPositionId: 'CP-1', ownershipRecognitionId: 'OWN-1', quantity: 10,
    matchReviewId: 'OMR-1', reservationId: 'RSV-1', allocationId: 'ALC-1'
  });
  await domain.put('COIN_POSITION', 'CP-1', { coinPositionId: 'CP-1', positionId: 'CP-1', participantId: 'BUYER-1', instrumentId: 'INS-1', availableQuantity: 10, state: 'ACTIVE' });
  await domain.put('OWNERSHIP_RECOGNITION', 'OWN-1', { ownershipRecognitionId: 'OWN-1', participantId: 'BUYER-1', instrumentId: 'INS-1', state: 'RECOGNIZED' });
  await domain.put('SRA_INSTRUMENT', 'INS-1', { instrumentId: 'INS-1', state: 'ACTIVE' });
}

test('settled ownership can be authorized into a ready export package without external transfer', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  const service = new PostSettlementExportService(domain);
  const preview = service.preview({ settlementId: 'STL-1' });
  assert.equal(preview.eligibilityState, 'ELIGIBLE_FOR_EXPORT_AUTHORIZATION');
  const result = await service.approve({ settlementId: 'STL-1', approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(result.state, 'READY_FOR_EXPORT');
  assert.equal(result.exportExecutionState, 'NOT_STARTED');
  assert.equal(result.externalWithdrawalState, 'DISABLED');
  assert.equal(domain.get('SRA_TRANSACTION', 'STL-1').exportState, 'READY_FOR_EXPORT');
});

test('restrictions and duplicate packages block export authorization', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  await domain.put('SRA_INSTRUMENT', 'INS-1', { instrumentId: 'INS-1', exportRestricted: true });
  const service = new PostSettlementExportService(domain);
  assert.equal(service.preview({ settlementId: 'STL-1' }).blockers.includes('INSTRUMENT_RESTRICTED'), true);
  await assert.rejects(() => service.approve({ settlementId: 'STL-1', approval: 'APPROVE' }, 'ADMIN-1'), /Export is blocked/);

  const clean = new MemoryDomain();
  await seed(clean);
  const cleanService = new PostSettlementExportService(clean);
  await cleanService.approve({ settlementId: 'STL-1', approval: 'APPROVE' }, 'ADMIN-1');
  await assert.rejects(() => cleanService.approve({ settlementId: 'STL-1', approval: 'APPROVE' }, 'ADMIN-1'), /blocked|already/i);
});

test('atomic failure leaves settlement, position, and ownership unchanged', async () => {
  const domain = new MemoryDomain();
  await seed(domain);
  domain.failAtomic = true;
  const service = new PostSettlementExportService(domain);
  await assert.rejects(() => service.approve({ settlementId: 'STL-1', approval: 'APPROVE' }, 'ADMIN-1'), /atomic failure/);
  assert.equal(domain.get('EXPORT_PACKAGE', 'EXP-1'), null);
  assert.equal(domain.get('SRA_TRANSACTION', 'STL-1').exportPackageId, undefined);
  assert.equal(domain.get('COIN_POSITION', 'CP-1').exportPackageId, undefined);
});
