import test from 'node:test';
import assert from 'node:assert/strict';
import { TreasuryTransferReadinessService } from '../services/treasury-transfer-readiness-service.js';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async atomicPut(changes) { for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload)); return changes.map((change) => structuredClone(change.payload)); }
}

async function setup(cash = 10) {
  const domain = new Domain();
  const treasury = new TreasuryLedgerService(domain);
  await treasury.initialize();
  if (cash > 0) await treasury.approve({ approval: 'APPROVE', memo: 'Opening cash', reference: 'OPEN', idempotencyKey: `OPEN-${cash}`, lines: [
    { accountId: 'TRSY-1000-CASH-USD', side: 'DEBIT', amount: cash },
    { accountId: 'TRSY-3000-PLATFORM-CAPITAL', side: 'CREDIT', amount: cash },
  ] }, 'ADMIN-1');
  const service = new TreasuryTransferReadinessService(domain, treasury);
  const destination = await service.approveDestination({ approval: 'APPROVE', ownerId: 'OWNER-1', label: 'Controlled ACH destination', rail: 'ACH', destinationReference: 'SECURE-REF-1', verificationState: 'VERIFIED' }, 'ADMIN-1');
  return { domain, treasury, service, destination: destination.destination };
}

test('prepares a one-dollar Treasury ACH transfer without moving external funds', async () => {
  const { domain, treasury, service, destination } = await setup(10);
  const preview = service.preview({ destinationId: destination.destinationId, amountUsd: 1 });
  assert.equal(preview.state, 'ELIGIBLE_FOR_TRANSFER_READINESS');
  assert.equal(preview.treasuryAvailableUsd, 10);
  const result = await service.approve({ approval: 'APPROVE', destinationId: destination.destinationId, amountUsd: 1, idempotencyKey: 'ONE-DOLLAR-TEST' }, 'ADMIN-1');
  assert.equal(result.created, true);
  assert.equal(result.exportPackage.state, 'READY_TO_SEND');
  assert.equal(result.transferInstruction.state, 'READY_TO_SEND');
  assert.equal(result.transferInstruction.route, 'ACH');
  assert.equal(result.reservation.holdState, 'HELD');
  assert.equal(treasury.summary().cashBalanceUsd, 10);
  assert.equal(domain.list(RECORD_TYPES.LEDGER_ENTRY).length, 1);
});

test('rejects insufficient Treasury cash', async () => {
  const { service, destination } = await setup(0);
  assert.throws(() => service.preview({ destinationId: destination.destinationId, amountUsd: 1 }), /insufficient/i);
});

test('requires a verified ACH destination', async () => {
  const { domain, treasury, destination } = await setup(10);
  const blocked = { ...destination, destinationId: 'DST-BLOCKED', verificationState: 'PENDING' };
  await domain.put('TRANSFER_DESTINATION', blocked.destinationId, blocked);
  const service = new TreasuryTransferReadinessService(domain, treasury);
  assert.throws(() => service.preview({ destinationId: blocked.destinationId, amountUsd: 1 }), /verified/i);
});

test('approval is idempotent and does not create duplicate holds', async () => {
  const { service, destination } = await setup(10);
  const input = { approval: 'APPROVE', destinationId: destination.destinationId, amountUsd: 1, idempotencyKey: 'ONE-DOLLAR-IDEMPOTENT' };
  const first = await service.approve(input, 'ADMIN-1');
  const second = await service.approve(input, 'ADMIN-1');
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(service.status().transferCount, 1);
  assert.equal(service.status().reservedUsd, 1);
});

test('active reservations reduce available Treasury transfer capacity', async () => {
  const { service, destination } = await setup(2);
  await service.approve({ approval: 'APPROVE', destinationId: destination.destinationId, amountUsd: 1.5, idempotencyKey: 'FIRST-HOLD' }, 'ADMIN-1');
  assert.throws(() => service.preview({ destinationId: destination.destinationId, amountUsd: 1 }), /insufficient/i);
});
