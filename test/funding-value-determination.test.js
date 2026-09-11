import test from 'node:test';
import assert from 'node:assert/strict';
import { FundingOpportunityValuePreparationService } from '../services/funding-opportunity-value-preparation-service.js';
import { FundingInstrumentSelectionService } from '../services/funding-instrument-selection-service.js';
import { DETERMINATION_RECORD_TYPES } from '../services/determination-engine-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.lifecycleEvents = []; }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() { return {}; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return structuredClone(payload); }
  async atomicPut(changes = []) {
    for (const change of changes) await this.put(change.type, change.id, change.payload);
    return changes.map((change) => structuredClone(change.payload));
  }
  async lifecycle(input) { this.lifecycleEvents.push(structuredClone(input)); return input; }
}

const OPPORTUNITY = 'FUNDING_OPPORTUNITY';
const VERIFIED_RECORD = 'FUNDING_OPPORTUNITY_VERIFIED_RECORD';
const INSTRUMENT_REQUEST = 'FUNDING_INSTRUMENT_SELECTION_REQUEST';
const INSTRUMENT_SELECTION = 'FUNDING_INSTRUMENT_SELECTION';

async function seedVerifiedOpportunity(domain) {
  await domain.put(VERIFIED_RECORD, 'FVRD-1', {
    verifiedRecordId: 'FVRD-1', opportunityId: 'FO-1', status: 'FROZEN', frozenAt: '2026-08-07T14:00:00.000Z',
    evidenceIds: ['EV-1','EV-2'], agreementIds: ['AGR-1'], transactionIds: ['TX-1'],
  });
  await domain.put(OPPORTUNITY, 'FO-1', {
    opportunityId: 'FO-1', status: 'VERIFIED', fundingPhase: 'VERIFIED_VALUE_PREPARATION', verifiedRecordId: 'FVRD-1',
    applicantParticipantId: 'P-1', opportunityType: 'PROJECT', purpose: 'PROJECT FUNDING', requestedAmount: 80000, currency: 'USD',
    relatedAssetIds: ['A-1'], relatedProjectIds: ['PRJ-1'], history: [],
  });
}

test('funding value preparation produces a canonical VVR and writes its lineage onto the opportunity', async () => {
  const domain = new MemoryDomain();
  await seedVerifiedOpportunity(domain);
  const service = new FundingOpportunityValuePreparationService(domain);
  await service.initialize();
  const preparation = await service.createPreparation('FO-1', {
    recognizedValue: 100000,
    recognizedCurrency: 'USD',
    valueDimensions: { existingVerifiedValue: 100000, collateralOrAssetSupport: 100000 },
  }, 'ADMIN-1');
  const completed = await service.completePreparation(preparation.preparationId, 'ADMIN-1');
  assert.equal(completed.preparation.valueReferenceArchitecture, 'CANONICAL_VVR_WITH_SRA_RVU_RECOGNITION');
  assert.ok(completed.preparation.canonicalVerifiedValueRecordId);
  assert.equal(completed.canonicalVerifiedValueRecord.value, 100000);
  assert.equal(completed.canonicalVerifiedValueRecord.state, 'CANONICAL');
  assert.equal(completed.canonicalVerifiedValueRecord.immutable, true);
  assert.ok(completed.canonicalVerifiedValueRecord.permittedUses.includes('CONTRACT_REFERENCE'));
  assert.equal(completed.canonicalVerifiedValueRecord.contractFormationBoundary.createsInstrument, false);
  const opportunity = domain.get(OPPORTUNITY, 'FO-1');
  assert.equal(opportunity.canonicalVerifiedValueRecordId, completed.canonicalVerifiedValueRecord.verifiedValueRecordId);
  assert.equal(opportunity.determinationId, completed.preparation.determinationId);
  assert.equal(opportunity.snapshotId, completed.preparation.snapshotId);
  assert.equal(domain.list(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE).length, 1);
  assert.equal(completed.recognizedValue.recognitionUnit, 'SRA/RVU');
  assert.equal(completed.recognizedValue.recognizedRvu, 100000);
  assert.equal(completed.recognizedValue.boundaries.createsCurrency, false);
  assert.equal(domain.list(RECORD_TYPES.SRA_RVU_RECOGNITION).length, 1);
});

test('unrelated PATCH updates preserve an explicit recognized value', async () => {
  const domain = new MemoryDomain();
  await seedVerifiedOpportunity(domain);
  const service = new FundingOpportunityValuePreparationService(domain);
  await service.initialize();
  const preparation = await service.createPreparation('FO-1', {
    recognizedValue: 100000,
    valueDimensions: { existingVerifiedValue: 50000, collateralOrAssetSupport: 50000 },
  }, 'ADMIN-1');
  const updated = await service.updatePreparation(preparation.preparationId, { assumptions: ['Updated assumption only'] }, 'ADMIN-1');
  assert.equal(updated.recognizedValue, 100000);
  const completed = await service.completePreparation(preparation.preparationId, 'ADMIN-1');
  assert.equal(completed.canonicalVerifiedValueRecord.value, 100000);
});

test('completion is idempotent and reuses the canonical VVR on retry', async () => {
  const domain = new MemoryDomain();
  await seedVerifiedOpportunity(domain);
  const service = new FundingOpportunityValuePreparationService(domain);
  await service.initialize();
  const preparation = await service.createPreparation('FO-1', { recognizedValue: 95000 }, 'ADMIN-1');
  const first = await service.completePreparation(preparation.preparationId, 'ADMIN-1');
  const second = await service.completePreparation(preparation.preparationId, 'ADMIN-1');
  assert.equal(second.preparation.canonicalVerifiedValueRecordId, first.preparation.canonicalVerifiedValueRecordId);
  assert.equal(second.canonicalVerifiedValueRecord.verifiedValueRecordId, first.canonicalVerifiedValueRecord.verifiedValueRecordId);
  assert.equal(domain.list(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE).length, 1);
  assert.equal(domain.list(DETERMINATION_RECORD_TYPES.DETERMINATION).length, 1);
  assert.equal(domain.list(DETERMINATION_RECORD_TYPES.SNAPSHOT).length, 1);
  assert.equal(domain.list(RECORD_TYPES.SRA_RVU_RECOGNITION).length, 1);
});

test('FedEx acquisition value is recognized before its settlement asset is selected', async () => {
  const domain = new MemoryDomain();
  await seedVerifiedOpportunity(domain);
  await domain.put(OPPORTUNITY, 'FO-1', {
    ...domain.get(OPPORTUNITY, 'FO-1'),
    title: 'FedEx Linehaul Acquisition',
    opportunityType: 'BUSINESS_ACQUISITION',
    purpose: 'ACQUIRE PRODUCTIVE ROUTE CONTRACTS',
    requestedAmount: 3900000,
  });
  const service = new FundingOpportunityValuePreparationService(domain);
  await service.initialize();
  const preparation = await service.createPreparation('FO-1', {
    recognizedValue: 3900000,
    recognizedCurrency: 'USD',
    productiveValueClass: 'AVAILABLE_PRODUCTION',
    economicPurposeClass: 'ACQUISITION',
    deliverability: { basis: 'ROUTE_CONTRACT_TRANSFER_AND_PROCESSING_CONFIRMATION' },
    valueDimensions: { existingVerifiedValue: 3900000, productiveCapacity: 1, revenueCapacity: 1, agreementSupport: 1 },
  }, 'ADMIN-1');
  const completed = await service.completePreparation(preparation.preparationId, 'ADMIN-1');
  assert.equal(completed.recognizedValue.recognizedRvu, 3900000);
  assert.equal(completed.recognizedValue.economicPurposeClass, 'ACQUISITION');
  assert.equal(completed.recognizedValue.productiveValueClass, 'AVAILABLE_PRODUCTION');
  assert.equal(completed.recognizedValue.boundaries.changesInstrumentIdentity, false);
  assert.equal(service.listSettlementEquivalences('FO-1').length, 0);

  const settlement = await service.recordSettlementEquivalence('FO-1', {
    recognizedRvu: 1000,
    settlementAssetCode: 'XRP',
    settlementAssetAmount: 400,
    network: 'XRPL',
    executionReference: 'EXEC-FEDEX-1',
    confirmationReference: 'CONF-FEDEX-1',
    transactionId: 'XRPL-TX-1',
    pricingSource: 'EXECUTED_SETTLEMENT_RECORD',
    settledAt: '2026-09-11T12:00:00.000Z',
  }, 'ADMIN-1');
  assert.equal(settlement.state, 'RECONCILED');
  assert.equal(settlement.changesUnderlyingRecognizedValue, false);
  assert.equal(service.listSettlementEquivalences('FO-1').length, 1);
});

test('draft instrument automatically inherits the canonical VVR from the prepared opportunity', async () => {
  const domain = new MemoryDomain();
  await seedVerifiedOpportunity(domain);
  const preparationService = new FundingOpportunityValuePreparationService(domain);
  await preparationService.initialize();
  const preparation = await preparationService.createPreparation('FO-1', { recognizedValue: 95000 }, 'ADMIN-1');
  const completed = await preparationService.completePreparation(preparation.preparationId, 'ADMIN-1');
  await domain.put(INSTRUMENT_REQUEST, 'FISR-1', {
    instrumentSelectionRequestId: 'FISR-1', opportunityId: 'FO-1', fundingModel: 'PROJECT_FUNDING', requestedAmount: 80000,
    currency: 'USD', candidateInstrumentFamilies: ['TRUE_BILL'], requiredCharacteristics: {}, verifiedRecordId: 'FVRD-1',
  });
  await domain.put(INSTRUMENT_SELECTION, 'FIS-1', {
    instrumentSelectionId: 'FIS-1', instrumentSelectionRequestId: 'FISR-1', opportunityId: 'FO-1', fundingModel: 'PROJECT_FUNDING',
    selectedInstrumentFamily: 'TRUE_BILL', terms: {}, restrictions: [], status: 'SELECTED',
  });
  const selectionService = new FundingInstrumentSelectionService(domain);
  await selectionService.initialize();
  const instrument = await selectionService.createDraftInstrument('FIS-1', { settlementRule: 'NET', governingDocumentId: 'DOC-1' }, 'ADMIN-1');
  assert.equal(instrument.canonicalVerifiedValueRecordId, completed.canonicalVerifiedValueRecord.verifiedValueRecordId);
  assert.equal(instrument.referencedDeterminationId, completed.preparation.determinationId);
  assert.equal(instrument.referencedSnapshotId, completed.preparation.snapshotId);
  assert.equal(instrument.valueReferenceArchitecture, 'CANONICAL_VVR_REFERENCE');
});

test('funding preparation without a recognized value remains explicitly legacy-compatible', async () => {
  const domain = new MemoryDomain();
  await seedVerifiedOpportunity(domain);
  const service = new FundingOpportunityValuePreparationService(domain);
  await service.initialize();
  const preparation = await service.createPreparation('FO-1', {}, 'ADMIN-1');
  const completed = await service.completePreparation(preparation.preparationId, 'ADMIN-1');
  assert.equal(completed.preparation.canonicalVerifiedValueRecordId, null);
  assert.equal(completed.preparation.valueReferenceArchitecture, 'LEGACY_COMPATIBILITY');
  assert.equal(domain.list(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE).length, 0);
});
