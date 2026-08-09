import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TreasuryLiveExecutionService } from '../services/treasury-live-execution-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  async put(type, id, value) { this.records.set(this.key(type, id), structuredClone(value)); }
  async atomicPut(changes) { for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload)); }
}

class FakeExecutor {
  constructor({ providerStatus = 'ACCEPTED', delayMs = 0 } = {}) { this.providerStatus = providerStatus; this.delayMs = delayMs; this.executeCalls = 0; }
  status() { return { rails: [{ rail: 'ACH', mode: 'LIVE', ready: true, endpointConfigured: true, credentialConfigured: true }] }; }
  assertCanExecute(instruction, confirmation) {
    assert.equal(instruction.state, 'READY');
    assert.equal(confirmation, `EXECUTE ${Number(instruction.amount).toFixed(2)} ${instruction.currency} VIA ACH`);
  }
  async execute(instruction, { confirmation } = {}) {
    this.executeCalls += 1;
    assert.equal(confirmation, `EXECUTE ${Number(instruction.amount).toFixed(2)} ${instruction.currency} VIA ACH`);
    assert.equal(instruction.transientDestination.routingNumber, '021000021');
    assert.equal(instruction.transientDestination.accountNumber, '123456789');
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { rail: 'ACH', requestId: `REQ-${this.executeCalls}`, endpointHost: 'provider.example', httpStatus: 202, providerReference: `PROVIDER-${this.executeCalls}`, providerStatus: this.providerStatus, requestedAt: '2026-08-09T15:00:00.000Z', payloadHash: 'payload-hash', responseHash: 'response-hash', response: { status: this.providerStatus } };
  }
}

async function seedPayment(domain, { id = 'XFR-1', amount = 1 } = {}) {
  await domain.put('SRA_TRANSACTION', id, {
    transactionId: id, transferInstructionId: id, transactionType: 'EXTERNAL_TRANSFER_INSTRUCTION',
    exportPackageId: 'EXP-1', amountUsd: amount, quantity: amount, currency: 'USD', route: 'ACH',
    destinationReference: 'ACH-DEST-OPAQUE', state: 'READY_TO_SEND', executionState: 'AUTHORIZED', fundsState: 'HELD', statusHistory: [],
  });
  await domain.put('EXPORT_PACKAGE', 'EXP-1', { exportPackageId: 'EXP-1', state: 'READY_TO_SEND', exportExecutionState: 'AUTHORIZED' });
}

const input = (id = 'XFR-1') => ({ transferInstructionId: id, routingNumber: '021000021', accountNumber: '123456789', accountType: 'CHECKING', bankName: 'Test Bank' });

test('ACH execution uses the authorized instruction amount and transient bank details', async () => {
  const domain = new MemoryDomain();
  await seedPayment(domain, { amount: 27.45 });
  const executor = new FakeExecutor();
  const service = new TreasuryLiveExecutionService(domain, { executor });
  const result = await service.executeAch(input(), 'ADMIN-1');
  assert.equal(result.instruction.amountUsd, 27.45);
  assert.equal(result.instruction.state, 'PROVIDER_ACCEPTED');
  assert.equal(result.instruction.fundsState, 'SUBMITTED');
  assert.equal(result.receivingConfirmationRequired, true);
  assert.equal(result.rawBankDetailsStored, false);
  const persisted = JSON.stringify(domain.get('SRA_TRANSACTION', 'XFR-1'));
  assert.equal(persisted.includes('021000021'), false);
  assert.equal(persisted.includes('123456789'), false);
});

test('different authorized ACH amounts use the same execution path', async () => {
  for (const amount of [1, 2, 125.67]) {
    const domain = new MemoryDomain();
    await seedPayment(domain, { amount });
    const service = new TreasuryLiveExecutionService(domain, { executor: new FakeExecutor() });
    const result = await service.executeAch(input(), 'ADMIN-1');
    assert.equal(result.instruction.amountUsd, amount);
  }
});

test('concurrent retries serialize by payment instruction', async () => {
  const domain = new MemoryDomain();
  await seedPayment(domain, { amount: 5 });
  const executor = new FakeExecutor({ delayMs: 25 });
  const service = new TreasuryLiveExecutionService(domain, { executor });
  const [first, second] = await Promise.allSettled([service.executeAch(input(), 'ADMIN-1'), service.executeAch(input(), 'ADMIN-2')]);
  assert.equal(executor.executeCalls, 1);
  assert.equal([first.status, second.status].filter((status) => status === 'fulfilled').length, 1);
});

test('receiving confirmation reconciles the same authorized amount', async () => {
  const domain = new MemoryDomain();
  await seedPayment(domain, { amount: 12.34 });
  const service = new TreasuryLiveExecutionService(domain, { executor: new FakeExecutor({ providerStatus: 'EXECUTED' }) });
  await service.executeAch(input(), 'ADMIN-1');
  const result = await service.reconcile({ transferInstructionId: 'XFR-1', receivingConfirmationReference: 'BANK-POSTED-1', confirmedAmount: 12.34 }, 'ADMIN-1');
  assert.equal(result.instruction.state, 'RECONCILED');
  assert.equal(result.instruction.fundsState, 'SETTLED');
});

test('administration exposes general ACH execution without canary or one-dollar restrictions', () => {
  const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
  const controls = fs.readFileSync(new URL('../public/admin/admin-settlement-execution-controls.js', import.meta.url), 'utf8');
  const route = fs.readFileSync(new URL('../routes/treasury-transfer-readiness-routes.js', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../services/treasury-live-execution-service.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /admin-settlement-execution-controls\.js/);
  assert.match(controls, /Send ACH/);
  assert.doesNotMatch(controls, /Send \$1 ACH|one-dollar|canary/i);
  assert.match(route, /ach\/execute/);
  assert.doesNotMatch(route, /execute-one-dollar-canary|ONE_DOLLAR_ACH_CANARY/i);
  assert.match(service, /executeAch/);
  assert.doesNotMatch(service, /executeOneDollarAch|one-dollar canary|canary endpoint/i);
});