import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TreasuryLiveExecutionService } from '../services/treasury-live-execution-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  async put(type, id, value) { this.records.set(this.key(type, id), structuredClone(value)); }
  async atomicPut(changes) {
    for (const change of changes) this.records.set(this.key(change.type, change.id), structuredClone(change.payload));
  }
}

class FakeExecutor {
  status() { return { rails: [{ rail: 'ACH', mode: 'LIVE', ready: true, endpointConfigured: true, credentialConfigured: true }] }; }
  assertCanExecute(instruction, confirmation) {
    assert.equal(instruction.state, 'READY');
    assert.equal(instruction.amount, 1);
    assert.equal(confirmation, 'EXECUTE 1.00 USD VIA ACH');
  }
  async execute(instruction) {
    assert.equal(instruction.transientDestination.routingNumber, '021000021');
    assert.equal(instruction.transientDestination.accountNumber, '123456789');
    return {
      rail: 'ACH', requestId: 'REQ-1', endpointHost: 'provider.example', httpStatus: 202,
      providerReference: 'PROVIDER-1', providerStatus: 'ACCEPTED', requestedAt: '2026-08-07T19:00:00.000Z',
      payloadHash: 'payload-hash', responseHash: 'response-hash', response: { status: 'ACCEPTED' },
    };
  }
}

test('one-dollar ACH canary uses bank details transiently and persists only provider evidence', async () => {
  const domain = new MemoryDomain();
  await domain.put('SRA_TRANSACTION', 'XFR-1', {
    transactionId: 'XFR-1', transferInstructionId: 'XFR-1', transactionType: 'EXTERNAL_TRANSFER_INSTRUCTION',
    exportPackageId: 'EXP-1', amountUsd: 1, quantity: 1, currency: 'USD', route: 'ACH',
    destinationReference: 'ACH-DEST-OPAQUE', state: 'READY_TO_SEND', executionState: 'AUTHORIZED',
    statusHistory: [],
  });
  await domain.put('EXPORT_PACKAGE', 'EXP-1', { exportPackageId: 'EXP-1', state: 'READY_TO_SEND', exportExecutionState: 'AUTHORIZED' });
  const service = new TreasuryLiveExecutionService(domain, { executor: new FakeExecutor() });
  const result = await service.executeOneDollarAch({
    transferInstructionId: 'XFR-1', routingNumber: '021000021', accountNumber: '123456789',
    accountType: 'CHECKING', bankName: 'Test Bank', confirmation: 'EXECUTE 1.00 USD VIA ACH',
  }, 'ADMIN-1');
  assert.equal(result.instruction.state, 'PROVIDER_ACCEPTED');
  assert.equal(result.receivingConfirmationRequired, true);
  assert.equal(result.rawBankDetailsStored, false);
  const persisted = JSON.stringify(domain.get('SRA_TRANSACTION', 'XFR-1'));
  assert.equal(persisted.includes('021000021'), false);
  assert.equal(persisted.includes('123456789'), false);
  assert.equal(domain.get('EXPORT_PACKAGE', 'EXP-1').exportExecutionState, 'PROVIDER_ACCEPTED');
});

test('canary refuses instructions other than prepared 1.00 USD ACH', async () => {
  const domain = new MemoryDomain();
  await domain.put('SRA_TRANSACTION', 'XFR-2', {
    transactionId: 'XFR-2', transferInstructionId: 'XFR-2', transactionType: 'EXTERNAL_TRANSFER_INSTRUCTION',
    amountUsd: 2, currency: 'USD', route: 'ACH', state: 'READY_TO_SEND', executionState: 'AUTHORIZED',
  });
  const service = new TreasuryLiveExecutionService(domain, { executor: new FakeExecutor() });
  await assert.rejects(() => service.executeOneDollarAch({ transferInstructionId: 'XFR-2' }), /only executes a prepared 1.00 USD/);
});

test('administration mounts canary control explicitly without an observer layer', () => {
  const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
  const controls = fs.readFileSync(new URL('../public/admin/admin-settlement-execution-controls.js', import.meta.url), 'utf8');
  const route = fs.readFileSync(new URL('../routes/treasury-transfer-readiness-routes.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /admin-settlement-execution-controls\.js/);
  assert.match(bootstrap, /mountAdminSettlementExecutionControls/);
  assert.match(controls, /Settlement Instructions/);
  assert.match(controls, /execute-one-dollar-canary/);
  assert.match(controls, /EXECUTE 1\.00 USD VIA ACH/);
  assert.doesNotMatch(controls, /MutationObserver/);
  assert.match(route, /TreasuryLiveExecutionService/);
  assert.match(route, /receivingConfirmationRequired/);
});
