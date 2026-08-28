import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionParticipationGatewayService } from '../services/transaction-participation-gateway-service.js';
import { GovernedActionExecutionService } from '../services/governed-action-execution-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  async put(type, id, record) { this.records.set(this.key(type, id), structuredClone(record)); return structuredClone(record); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
}

async function seed(domain) {
  await domain.put('EXPORT_PACKAGE', 'EXP-100', {
    id: 'EXP-100', exportPackageId: 'EXP-100', exportKind: 'FINANCING_DISBURSEMENT',
    financingTransactionId: 'FTX-100', opportunityId: 'FOR-100', closingId: 'FCL-100',
    beneficiaryName: 'Example Dealer', amount: 48750, currency: 'USD', state: 'READY_FOR_SETTLEMENT_INSTRUCTION',
  });
}

test('transaction participation window is scoped to package plus access code', async () => {
  const domain = new Domain();
  await seed(domain);
  const service = new TransactionParticipationGatewayService(domain);
  const created = await service.createWindow('EXP-100', { recipientName: 'Example Dealer' });
  assert.ok(created.accessCode);
  assert.equal(created.window.exportPackageId, 'EXP-100');
  assert.equal(created.window.transaction.financingTransactionId, 'FTX-100');
  assert.throws(() => service.authenticate({ packageReference: 'EXP-100', accessCode: 'WRONG' }), /could not be verified/i);
  const authenticated = service.authenticate({ packageReference: 'FTX-100', accessCode: created.accessCode });
  assert.equal(authenticated.record.windowId, created.window.windowId);
});

test('external clarification and confirmation become transaction-bound operational events', async () => {
  const domain = new Domain();
  await seed(domain);
  const service = new TransactionParticipationGatewayService(domain);
  const created = await service.createWindow('EXP-100');
  const credentials = { packageReference: 'EXP-100', accessCode: created.accessCode, windowId: created.window.windowId };

  await service.confirmReceipt(credentials, { contactName: 'Jordan Smith', organization: 'Example Dealer', role: 'Finance Manager' });
  await service.askQuestion(credentials, {
    contactName: 'Jordan Smith', organization: 'Example Dealer', role: 'Finance Manager',
    topic: 'ACH_PROCESSING', question: 'Which transaction reference should accompany the ACH processing record?',
  });
  await service.confirmProcessing(credentials, { externalReference: 'BANK-REF-100' });

  const participationEvents = domain.list('TRANSACTION_PARTICIPATION_EVENT');
  assert.ok(participationEvents.some((event) => event.eventType === 'FUNDING_PACKAGE_RECEIPT_CONFIRMED'));
  assert.ok(participationEvents.some((event) => event.eventType === 'PROCESSING_CLARIFICATION_REQUESTED'));
  assert.ok(participationEvents.some((event) => event.eventType === 'PACKAGE_SUBMITTED_FOR_PROCESSING'));

  const intelligenceEvents = domain.list('OPERATIONAL_EVENT');
  const clarification = intelligenceEvents.find((event) => event.eventType === 'PROCESSING_CLARIFICATION_REQUESTED');
  assert.equal(clarification.financingTransactionId, 'FTX-100');
  assert.equal(clarification.exportPackageId, 'EXP-100');
  assert.equal(clarification.payload.organization, 'Example Dealer');
});

test('funding package execution opens one participation window and exposes the access code once', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('AGENT_DECISION', 'AD-1', { id: 'AD-1', decisionId: 'AD-1', agentId: 'SRA-EXPORT-AGENT', decision: 'GENERATE_CONTEXT_REQUIRED_INSTRUCTIONS' });
  await domain.put('ACTION_PLAN', 'AP-1', {
    id: 'AP-1', planId: 'AP-1', transactionId: 'FTX-100', sourceDecisionId: 'AD-1', createdByAgentId: 'SRA-EXPORT-AGENT', status: 'READY',
    steps: [{ id: 'FUNDING_SETTLEMENT', action: 'INCLUDE_DOCUMENT', documentType: 'FUNDING_SETTLEMENT', status: 'REQUIRED' }],
  });

  const packetService = {
    async renderFundingPackage() { return Buffer.from('funding-package'); },
    async renderDealerProcessingInstructions() { return Buffer.from('dealer'); },
    async renderServicingInstructions() { return Buffer.from('servicing'); },
  };
  const service = new GovernedActionExecutionService(domain, { packetService });
  const first = await service.executePlan('AP-1', { exportPackageId: 'EXP-100' });
  assert.equal(first.status, 'COMPLETED');
  assert.equal(domain.list('TRANSACTION_PARTICIPATION_WINDOW').length, 1);
  assert.ok(first.results[0].data.participationAccessCode);

  const second = await service.executePlan('AP-1', { exportPackageId: 'EXP-100' });
  assert.equal(second.results[0].resultId, first.results[0].resultId);
  assert.equal(domain.list('TRANSACTION_PARTICIPATION_WINDOW').length, 1);
});
