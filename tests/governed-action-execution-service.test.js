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
  constructor() { this.calls = []; }
  async renderFundingPackage(id) { this.calls.push(['FUNDING_SETTLEMENT', id]); return Buffer.from('funding'); }
  async renderDealerProcessingInstructions(id) { this.calls.push(['DEALER_PROCESSING_INSTRUCTIONS', id]); return Buffer.from('dealer'); }
  async renderServicingInstructions(id) { this.calls.push(['SERVICING_PAYMENT_INSTRUCTIONS', id]); return Buffer.from('servicing'); }
}

async function seedReadyPlan(domain, steps = null) {
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

test('Phase 3 executes ready safe-preparation steps through existing SRA document services', async () => {
  const domain = new Domain();
  const packetService = new PacketService();
  await seedReadyPlan(domain);
  domain.putCalls = [];

  const service = new GovernedActionExecutionService(domain, { packetService });
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
  assert.equal(domain.list('ACTION_RESULT').length, 4);
  assert.ok(domain.list('ACTION_RESULT').every((record) => record.data.authorityRequired === false));
});

test('Phase 3 does not cross protected approval, settlement, or external-execution authority', async () => {
  const domain = new Domain();
  const packetService = new PacketService();
  await seedReadyPlan(domain, [
    { id: 'PREPARE', action: 'INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS', status: 'REQUIRED' },
    { id: 'SETTLE', action: 'EXECUTE_SETTLEMENT', status: 'REQUIRED' },
    { id: 'TRANSFER', action: 'EXECUTE_EXTERNAL_TRANSFER', status: 'REQUIRED' },
  ]);

  const service = new GovernedActionExecutionService(domain, { packetService });
  const execution = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(execution.status, 'AWAITING_AUTHORITY');
  assert.equal(execution.completedCount, 1);
  assert.equal(execution.awaitingAuthorityCount, 2);
  const protectedResults = execution.results.filter((result) => result.status === 'AWAITING_AUTHORITY');
  assert.deepEqual(protectedResults.map((result) => result.action), ['EXECUTE_SETTLEMENT', 'EXECUTE_EXTERNAL_TRANSFER']);
  assert.ok(protectedResults.every((result) => result.data.executionClass === 'PROTECTED'));
  assert.ok(protectedResults.every((result) => result.data.authorityReason === 'RESERVED_AUTHORITY'));
});

test('Phase 3 is idempotent and does not repeat completed document generation on retry', async () => {
  const domain = new Domain();
  const packetService = new PacketService();
  await seedReadyPlan(domain);
  const service = new GovernedActionExecutionService(domain, { packetService });

  const first = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });
  const second = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(first.status, 'COMPLETED');
  assert.equal(second.status, 'COMPLETED');
  assert.equal(domain.list('ACTION_RESULT').length, 4);
  assert.equal(packetService.calls.length, 3, 'completed document generators should not execute twice');
  assert.deepEqual(second.results.map((record) => record.resultId), first.results.map((record) => record.resultId));
});

test('Phase 3 blocks plans whose Phase 2 context is not ready', async () => {
  const domain = new Domain();
  await domain.put('ACTION_PLAN', 'AP-CONTEXT-EXP-1', {
    id: 'AP-CONTEXT-EXP-1',
    planId: 'AP-CONTEXT-EXP-1',
    transactionId: 'LFA-1',
    createdByAgentId: 'SRA-EXPORT-AGENT',
    status: 'BLOCKED_CONTEXT_REQUIRED',
    steps: [{ id: 'FLAG', action: 'FLAG_DO_NOT_INFER', fields: ['AUTHORIZED_SETTLEMENT_AMOUNT'] }],
  });

  const service = new GovernedActionExecutionService(domain, { packetService: new PacketService() });
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

  const service = new GovernedActionExecutionService(domain, { packetService });
  const execution = await service.executePlan('AP-CONTEXT-EXP-1', { exportPackageId: 'EXP-1' });

  assert.equal(execution.status, 'FAILED');
  assert.equal(execution.failedCount, 1);
  assert.equal(execution.results[0].status, 'FAILED');
  assert.equal(execution.results[0].error, 'document generation failed');
  assert.equal(domain.list('OUTCOME_EVALUATION').length, 0, 'action execution must not fabricate external outcome evidence');
});
