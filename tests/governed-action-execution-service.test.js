import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernedActionExecutionService } from '../services/governed-action-execution-service.js';

class Domain {
  constructor() { this.records = new Map(); this.putCalls = []; }
  key(type, id) { return `${type}:${id}`; }
  async put(type, id, record) {
    this.putCalls.push({ type, id, record });
    this.records.set(this.key(type, id), record);
    return record;
  }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
  }
}

class PacketService {
  constructor() {
    this.calls = [];
    this.stored = [];
    this.documents = {
      store: async ({ file, documentType }) => {
        const id = `DOC-${this.stored.length + 1}`;
        const document = { id, documentType, originalName: file.originalname, sha256: `sha-${id}`, size: file.size };
        this.stored.push({ file, documentType, document });
        return { ok: true, document };
      },
    };
  }
  async renderFundingPackage(id) { this.calls.push(['FUNDING_SETTLEMENT', id]); return Buffer.from('funding'); }
  async renderDealerProcessingInstructions(id) { this.calls.push(['DEALER_PROCESSING_INSTRUCTIONS', id]); return Buffer.from('dealer'); }
  async renderServicingInstructions(id) { this.calls.push(['SERVICING_PAYMENT_INSTRUCTIONS', id]); return Buffer.from('servicing'); }
}

class ParticipationGateway {
  constructor() { this.calls = []; }
  async createWindow(exportPackageId) {
    this.calls.push(exportPackageId);
    return { window: { windowId: 'TPW-1', exportPackageId }, accessCode: 'ACCESS-1', existing: false };
  }
}

async function seedTransaction(domain) {
  await domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1',
    transactionProfile: {
      payeeName: 'Example Dealer',
      repaymentTerms: { paymentAmount: 850, paymentFrequency: 'Monthly' },
    },
  });
  await domain.put('FINANCING_CLOSING', 'FCL-1', {
    closingId: 'FCL-1',
    beneficiaryName: 'Example Dealer',
  });
  await domain.put('EXPORT_PACKAGE', 'EXP-1', {
    exportPackageId: 'EXP-1',
    exportKind: 'FINANCING_DISBURSEMENT',
    financingTransactionId: 'LFA-1',
    opportunityId: 'FOR-1',
    closingId: 'FCL-1',
    beneficiaryName: 'Example Dealer',
    amount: 50000,
    currency: 'USD',
  });
}

async function seedReadyPlan(domain, steps = null) {
  await seedTransaction(domain);
  await domain.put('AGENT_DECISION', 'AD-CONTEXT-EXP-1', {
    id: 'AD-CONTEXT-EXP-1',
    decisionId: 'AD-CONTEXT-EXP-1',
    agentId: 'SRA-EXPORT-AGENT',
    decision: 'GENERATE_CONTEXT_REQUIRED_INSTRUCTIONS',
    transactionId: 'LFA-1',
    authorityRequired: false,
    authorityStatus: 'NOT_REQUIRED',
  });
  await domain.put('ACTION_PLAN', 'AP-CONTEXT-EXP-1', {
    id: 'AP-CONTEXT-EXP-1',
    planId: 'AP-CONTEXT-EXP-1',
    transactionId: 'LFA-1',
    createdByAgentId: 'SRA-EXPORT-AGENT',
    sourceDecisionId: 'AD-CONTEXT-EXP-1',
    status: 'READY',
    steps: steps || [
      { id: 'FUNDING_SETTLEMENT', action: 'INCLUDE_DOCUMENT', documentType: 'FUNDING_SETTLEMENT', status: 'REQUIRED' },
      { id: 'DEALER_PROCESSING_INSTRUCTIONS', action: 'INCLUDE_DOCUMENT', documentType: 'DEALER_PROCESSING_INSTRUCTIONS', status: 'REQUIRED' },
      { id: 'SERVICING_PAYMENT_INSTRUCTIONS', action: 'INCLUDE_DOCUMENT', documentType: 'SERVICING_PAYMENT_INSTRUCTIONS', status: 'REQUIRED' },
      { id: 'EXTERNAL_RECIPIENT_HANDOFF', action: 'INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS', status: 'REQUIRED' },
    ],
  });
}

function createService(domain, packetService = new PacketService()) {
  return {
    packetService,
    service: new GovernedActionExecutionService(domain, {
      packetService,
      participationGateway: new ParticipationGateway(),
    }),
  };
}

test('Phase 3 executes ready safe-preparation steps and persists generated documents before completion', async () => {
  const domain = new Domain();
  await seedReadyPlan(domain);
  domain.putCalls = [];
  const { service, packetService } = createService(domain);

  const execution = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(execution.status, 'COMPLETED');
  assert.equal(execution.completedCount, 4);
  assert.equal(execution.awaitingAuthorityCount, 0);
  assert.equal(execution.failedCount, 0);
  assert.deepEqual(packetService.calls, [
    ['FUNDING_SETTLEMENT', 'EXP-1'],
    ['DEALER_PROCESSING_INSTRUCTIONS', 'EXP-1'],
    ['SERVICING_PAYMENT_INSTRUCTIONS', 'EXP-1'],
  ]);
  assert.equal(packetService.stored.length, 3);
  const documentResults = execution.results.filter((result) => result.action === 'INCLUDE_DOCUMENT');
  assert.ok(documentResults.every((result) => result.externalReference?.startsWith('DOC-')));
  assert.ok(documentResults.every((result) => result.data.retrievable === true));
  assert.ok(documentResults.every((result) => result.data.documentId === result.externalReference));
});

test('Phase 3 does not cross protected approval, settlement, or external-execution authority', async () => {
  const domain = new Domain();
  await seedReadyPlan(domain, [
    { id: 'PREPARE', action: 'INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS', status: 'REQUIRED' },
    { id: 'SETTLE', action: 'EXECUTE_SETTLEMENT', status: 'REQUIRED' },
    { id: 'TRANSFER', action: 'EXECUTE_EXTERNAL_TRANSFER', status: 'REQUIRED' },
  ]);

  const { service } = createService(domain);
  const execution = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(execution.status, 'AWAITING_AUTHORITY');
  assert.equal(execution.completedCount, 1);
  assert.equal(execution.awaitingAuthorityCount, 2);
  const protectedResults = execution.results.filter((result) => result.status === 'AWAITING_AUTHORITY');
  assert.deepEqual(protectedResults.map((result) => result.action), ['EXECUTE_SETTLEMENT', 'EXECUTE_EXTERNAL_TRANSFER']);
  assert.ok(protectedResults.every((result) => result.data.executionClass === 'PROTECTED'));
  assert.ok(protectedResults.every((result) => result.data.authorityReason === 'RESERVED_AUTHORITY'));
});

test('Phase 3 is idempotent while authoritative step inputs remain unchanged', async () => {
  const domain = new Domain();
  await seedReadyPlan(domain);
  const { service, packetService } = createService(domain);

  const first = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });
  const second = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(first.status, 'COMPLETED');
  assert.equal(second.status, 'COMPLETED');
  assert.equal(domain.list('ACTION_RESULT').length, 4);
  assert.equal(packetService.calls.length, 3, 'unchanged completed document generators should not execute twice');
  assert.equal(packetService.stored.length, 3, 'unchanged generated artifacts should not be duplicated');
});

test('Phase 3 invalidates completed same-ID steps when authoritative transaction inputs change', async () => {
  const domain = new Domain();
  await seedReadyPlan(domain, [
    { id: 'FUNDING_SETTLEMENT', action: 'INCLUDE_DOCUMENT', documentType: 'FUNDING_SETTLEMENT', status: 'REQUIRED' },
  ]);
  const { service, packetService } = createService(domain);

  const first = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });
  const originalResult = first.results[0];
  await domain.put('EXPORT_PACKAGE', 'EXP-1', {
    ...domain.get('EXPORT_PACKAGE', 'EXP-1'),
    amount: 52500,
  });
  const second = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(second.status, 'COMPLETED');
  assert.equal(packetService.calls.length, 2, 'changed authoritative input must regenerate the funding package');
  assert.equal(packetService.stored.length, 2);
  assert.notEqual(second.results[0].data.inputFingerprint, originalResult.data.inputFingerprint);
  assert.notEqual(second.results[0].externalReference, originalResult.externalReference);
});

test('Phase 3 reclassifies an earlier unmapped result after an executor is registered', async () => {
  const domain = new Domain();
  await seedReadyPlan(domain, [
    { id: 'NEW_SAFE_STEP', action: 'NEW_SAFE_ACTION', status: 'REQUIRED', value: 'v1' },
  ]);
  const { service } = createService(domain);

  const first = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });
  assert.equal(first.status, 'AWAITING_AUTHORITY');
  assert.equal(first.results[0].data.authorityReason, 'NO_REGISTERED_EXECUTOR');

  let calls = 0;
  service.register('NEW_SAFE_ACTION', async () => {
    calls += 1;
    return { status: 'COMPLETED', externalReference: 'safe-action:1', data: { executed: true } };
  });
  const second = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(second.status, 'COMPLETED');
  assert.equal(second.results[0].status, 'COMPLETED');
  assert.equal(second.results[0].data.executionClass, 'SAFE_PREPARATION');
  assert.equal(calls, 1);
});

test('Phase 3 summary stays READY when a refreshed plan adds an unexecuted required step', async () => {
  const domain = new Domain();
  await seedReadyPlan(domain, [
    { id: 'PREPARE', action: 'INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS', status: 'REQUIRED' },
  ]);
  const { service } = createService(domain);
  await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  const refreshed = {
    ...domain.get('ACTION_PLAN', 'AP-CONTEXT-EXP-1'),
    steps: [
      { id: 'PREPARE', action: 'INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS', status: 'REQUIRED' },
      { id: 'NEW_HANDOFF', action: 'INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS', status: 'REQUIRED' },
    ],
  };
  await domain.put('ACTION_PLAN', 'AP-CONTEXT-EXP-1', refreshed);
  const summary = service.summarizePlan(refreshed, 'EXP-1');

  assert.equal(summary.status, 'READY');
  assert.equal(summary.expectedCount, 2);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.pendingCount, 1);
});

test('Phase 3 blocks plans whose Phase 2 context is not ready', async () => {
  const domain = new Domain();
  await seedTransaction(domain);
  await domain.put('ACTION_PLAN', 'AP-CONTEXT-EXP-1', {
    id: 'AP-CONTEXT-EXP-1',
    planId: 'AP-CONTEXT-EXP-1',
    transactionId: 'LFA-1',
    createdByAgentId: 'SRA-EXPORT-AGENT',
    status: 'BLOCKED_CONTEXT_REQUIRED',
    steps: [{ id: 'FLAG', action: 'FLAG_DO_NOT_INFER', fields: ['AUTHORIZED_SETTLEMENT_AMOUNT'] }],
  });

  const { service } = createService(domain);
  const execution = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(execution.status, 'BLOCKED');
  assert.equal(execution.results.length, 0);
  assert.equal(domain.list('ACTION_RESULT').length, 0);
});

test('Phase 3 records execution failure without claiming an external outcome', async () => {
  const domain = new Domain();
  await seedReadyPlan(domain, [
    { id: 'FUNDING_SETTLEMENT', action: 'INCLUDE_DOCUMENT', documentType: 'FUNDING_SETTLEMENT', status: 'REQUIRED' },
  ]);
  const packetService = new PacketService();
  packetService.renderFundingPackage = async () => { throw new Error('document generation failed'); };
  const { service } = createService(domain, packetService);

  const execution = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(execution.status, 'FAILED');
  assert.equal(execution.failedCount, 1);
  assert.equal(execution.results[0].status, 'FAILED');
  assert.equal(execution.results[0].error, 'document generation failed');
  assert.equal(domain.list('OUTCOME_EVALUATION').length, 0, 'action execution must not fabricate external outcome evidence');
});
