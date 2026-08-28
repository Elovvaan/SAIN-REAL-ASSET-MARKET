import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { TransactionParticipationGatewayService } from '../services/transaction-participation-gateway-service.js';
import { GovernedActionExecutionService } from '../services/governed-action-execution-service.js';

class Domain {
  constructor(backing = new Map()) { this.records = new Map(); this.backing = backing; }
  key(type, id) { return `${type}:${id}`; }
  async put(type, id, record) {
    const value = structuredClone(record);
    this.records.set(this.key(type, id), value);
    this.backing.set(this.key(type, id), value);
    return structuredClone(value);
  }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
  async hydrate(types = []) {
    for (const type of types) {
      const prefix = `${type}:`;
      for (const [key, value] of this.backing.entries()) {
        if (key.startsWith(prefix)) this.records.set(key, structuredClone(value));
      }
    }
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

test('reusing an open participation window reissues a recoverable active access code', async () => {
  const domain = new Domain();
  await seed(domain);
  const service = new TransactionParticipationGatewayService(domain);
  const first = await service.createWindow('EXP-100');
  const second = await service.createWindow('EXP-100');

  assert.equal(second.window.windowId, first.window.windowId);
  assert.equal(second.reissued, true);
  assert.ok(second.accessCode);
  assert.notEqual(second.accessCode, first.accessCode);
  assert.throws(() => service.authenticate({ packageReference: 'EXP-100', accessCode: first.accessCode }), /could not be verified/i);
  assert.equal(service.authenticate({ packageReference: 'EXP-100', accessCode: second.accessCode }).record.windowId, first.window.windowId);
});

test('participation windows and activity hydrate from persistent records after restart', async () => {
  const backing = new Map();
  const firstDomain = new Domain(backing);
  await seed(firstDomain);
  const firstService = new TransactionParticipationGatewayService(firstDomain);
  const created = await firstService.createWindow('EXP-100');
  const credentials = { packageReference: 'EXP-100', accessCode: created.accessCode, windowId: created.window.windowId };
  await firstService.confirmReceipt(credentials, { contactName: 'Jordan Smith', organization: 'Example Dealer' });

  const restartedDomain = new Domain(backing);
  await restartedDomain.hydrate(['EXPORT_PACKAGE']);
  const restartedService = new TransactionParticipationGatewayService(restartedDomain);
  const recovered = await restartedService.access(credentials);

  assert.equal(recovered.window.windowId, created.window.windowId);
  assert.ok(recovered.activity.some((event) => event.eventType === 'FUNDING_PACKAGE_RECEIPT_CONFIRMED'));
  assert.ok(restartedDomain.list('TRANSACTION_PARTICIPATION_WINDOW').length === 1);
  assert.ok(restartedDomain.list('TRANSACTION_PARTICIPATION_EVENT').length >= 2);
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

test('participant upload route stores evidence against the export package, not applicant fact-mapping reference', async () => {
  const source = await fs.readFile(new URL('../routes/transaction-participation-gateway-router.js', import.meta.url), 'utf8');
  assert.match(source, /retentionReferenceId:\s*verified\.pkg\.exportPackageId/);
  assert.doesNotMatch(source, /retentionReferenceId:\s*verified\.pkg\.opportunityId/);
});

test('funding package execution opens one participation window and persists a retrievable artifact', async () => {
  const domain = new Domain();
  await seed(domain);
  await domain.put('AGENT_DECISION', 'AD-1', { id: 'AD-1', decisionId: 'AD-1', agentId: 'SRA-EXPORT-AGENT', decision: 'GENERATE_CONTEXT_REQUIRED_INSTRUCTIONS' });
  await domain.put('ACTION_PLAN', 'AP-1', {
    id: 'AP-1', planId: 'AP-1', transactionId: 'FTX-100', sourceDecisionId: 'AD-1', createdByAgentId: 'SRA-EXPORT-AGENT', status: 'READY',
    steps: [{ id: 'FUNDING_SETTLEMENT', action: 'INCLUDE_DOCUMENT', documentType: 'FUNDING_SETTLEMENT', status: 'REQUIRED' }],
  });

  const stored = [];
  const packetService = {
    documents: {
      async store({ file, documentType }) {
        const document = { id: `DOC-${stored.length + 1}`, documentType, sha256: 'sha-test', size: file.size };
        stored.push(document);
        return { ok: true, document };
      },
    },
    async renderFundingPackage() { return Buffer.from('funding-package'); },
    async renderDealerProcessingInstructions() { return Buffer.from('dealer'); },
    async renderServicingInstructions() { return Buffer.from('servicing'); },
  };
  const service = new GovernedActionExecutionService(domain, { packetService });
  const first = await service.executePlan('AP-1', { exportPackageId: 'EXP-100' });
  assert.equal(first.status, 'COMPLETED');
  assert.equal(domain.list('TRANSACTION_PARTICIPATION_WINDOW').length, 1);
  assert.ok(first.results[0].data.participationAccessCode);
  assert.equal(first.results[0].externalReference, 'DOC-1');
  assert.equal(stored.length, 1);

  const second = await service.executePlan('AP-1', { exportPackageId: 'EXP-100' });
  assert.equal(second.results[0].resultId, first.results[0].resultId);
  assert.equal(domain.list('TRANSACTION_PARTICIPATION_WINDOW').length, 1);
  assert.equal(stored.length, 1);
});
