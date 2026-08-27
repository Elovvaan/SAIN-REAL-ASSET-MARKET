import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationalIntelligenceIntegrationService } from '../services/operational-intelligence-integration-service.js';

class MemoryDomain {
  constructor() { this.store = new Map(); }
  create(type, record) {
    if (!this.store.has(type)) this.store.set(type, []);
    this.store.get(type).push(record);
    return record;
  }
  list(type) { return this.store.get(type) || []; }
}

test('queue observations are idempotent and become operational memory', () => {
  const domain = new MemoryDomain();
  const integration = new OperationalIntelligenceIntegrationService(domain);
  const queue = {
    queue: [{ id: 'EP-1', stage: 'FINANCING_EXPORT', state: 'READY_FOR_SETTLEMENT_INSTRUCTION', exportPackageId: 'EP-1', nextAction: 'GENERATE_DEALER_FUNDING_PACKAGE', agentId: 'SRA-EXPORT-AGENT' }],
    exceptions: [],
  };
  integration.captureQueue(queue);
  integration.captureQueue(queue);
  assert.equal(domain.list('OPERATIONAL_EVENT').length, 1);
  assert.equal(domain.list('OPERATIONAL_MEMORY').length, 1);
});

test('funding package generation records state without inventing external success', () => {
  const domain = new MemoryDomain();
  const integration = new OperationalIntelligenceIntegrationService(domain);
  integration.captureFundingPackage({ exportPackageId: 'EP-2', financingTransactionId: 'FT-2', exportKind: 'FINANCING_DISBURSEMENT', amount: 4600000, currency: 'USD' });
  assert.equal(domain.list('OPERATIONAL_EVENT')[0].eventType, 'FUNDING_PACKAGE_GENERATED');
  assert.equal(domain.list('OUTCOME_EVALUATION').length, 0);
});

test('external outcomes are only created from recorded external result input', () => {
  const domain = new MemoryDomain();
  const integration = new OperationalIntelligenceIntegrationService(domain);
  integration.captureExternalOutcome({ financingTransactionId: 'FT-3', status: 'ADDITIONAL_INFORMATION_REQUIRED', externalReference: 'MSG-1', observed: 'Recipient requested proof of funding.' });
  assert.equal(domain.list('OUTCOME_EVALUATION').length, 1);
  assert.equal(domain.list('OUTCOME_EVALUATION')[0].status, 'ADDITIONAL_INFORMATION_REQUIRED');
});
