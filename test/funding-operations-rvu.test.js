import test from 'node:test';
import assert from 'node:assert/strict';
import { FundingOperationsService } from '../services/funding-operations-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() { return {}; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) {
    this.records.set(this.key(type, id), structuredClone(payload));
    return structuredClone(payload);
  }
}

test('funding operations exposes recognized value and executed settlement equivalence', async () => {
  const domain = new MemoryDomain();
  await domain.put('FUNDING_OPPORTUNITY', 'FO-FEDEX', {
    opportunityId: 'FO-FEDEX',
    title: 'FedEx Linehaul Acquisition',
    status: 'VALUE_PREPARED',
    requestedAmount: 3900000,
    currency: 'USD',
    updatedAt: '2026-09-11T12:00:00.000Z',
  });
  await domain.put('SRA_RVU_RECOGNITION', 'RVU-FO-FEDEX', {
    rvuRecognitionId: 'RVU-FO-FEDEX',
    opportunityId: 'FO-FEDEX',
    recognizedRvu: 3900000,
    recognitionUnit: 'SRA/RVU',
    productiveValueClass: 'AVAILABLE_PRODUCTION',
    economicPurposeClass: 'ACQUISITION',
  });
  await domain.put('SRA_SETTLEMENT_EQUIVALENCE', 'SEQ-1', {
    settlementEquivalenceId: 'SEQ-1',
    opportunityId: 'FO-FEDEX',
    recognizedRvu: 1000,
    settlementAssetCode: 'XRP',
    settlementAssetAmount: 400,
    executionReference: 'EXEC-1',
  });

  const service = new FundingOperationsService(domain);
  await service.initialize();
  const detail = service.opportunityDetail('FO-FEDEX');
  const dashboard = service.dashboard();

  assert.equal(detail.recognizedValues[0].recognizedRvu, 3900000);
  assert.equal(detail.settlementEquivalences[0].executionReference, 'EXEC-1');
  assert.deepEqual(detail.modelAssessments, []);
  assert.equal(dashboard.metrics.totalRecognizedRvu, 3900000);
  assert.equal(dashboard.metrics.rvuRecognizedOpportunities, 1);
  assert.equal(dashboard.metrics.settlementEquivalences, 1);
  assert.equal(service.phaseSummary().find(({ stage }) => stage === 'UNDERWRITING').count, 1);
});
