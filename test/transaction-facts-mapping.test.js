import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionFactsMappingService } from '../services/transaction-facts-mapping-service.js';

class Domain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  async put(type, id, payload) { this.records.set(this.key(type, id), payload); return payload; }
  async lifecycle(event) { this.events.push(event); return event; }
}

test('extracted purchase agreement facts map to the funding opportunity and related asset', async () => {
  const domain = new Domain();
  domain.records.set(domain.key('FUNDING_OPPORTUNITY', 'FOR-AUDI-1'), {
    opportunityId: 'FOR-AUDI-1',
    applicantParticipantId: 'P-BUYER',
    opportunityType: 'VEHICLE_FINANCING',
    requestedAmount: 50000,
    currency: 'USD',
    relatedAssetIds: ['AST-AUDI-1'],
    transactionFacts: [],
  });
  domain.records.set(domain.key('ASSET_ACCOUNT', 'AST-AUDI-1'), {
    assetId: 'AST-AUDI-1',
    name: 'Vehicle acquisition',
    metadata: {},
  });

  const document = {
    id: 'DOC-AUDI-1',
    sha256: 'a'.repeat(64),
    documentType: 'PURCHASE_AGREEMENT',
    originalName: 'Audi Purchase Agreement.pdf',
    extraction: {
      status: 'EXTRACTED',
      extractedAt: '2026-08-22T16:00:00.000Z',
      model: 'test-model',
      facts: {
        documentType: 'VEHICLE_PURCHASE_AGREEMENT',
        transactionType: 'VEHICLE_PURCHASE',
        identifiers: { agreementNumber: 'PA-88421', contractNumber: null, loanNumber: null, fileNumber: null },
        parties: [
          { role: 'BUYER', legalName: 'House Morris Trust' },
          { role: 'DEALER', legalName: 'Audi Dealer LLC' },
        ],
        asset: { type: 'VEHICLE', description: '2026 Audi Q5', vin: 'WA1TESTVIN1234567', year: '2026', make: 'Audi', model: 'Q5' },
        economicTerms: { purchasePrice: 48750, financedAmount: 48750, currency: 'USD' },
        dates: { agreementDate: '2026-08-22' },
        obligations: [],
        settlement: { amount: 48750, payee: 'Audi Dealer LLC', rail: null },
        execution: { signers: [] },
        sourceEvidence: [{ field: 'asset.vin', value: 'WA1TESTVIN1234567', page: 1, sourceLabel: 'VIN' }],
      },
    },
  };

  const result = await new TransactionFactsMappingService(domain).applyToOpportunity('FOR-AUDI-1', document, 'ADMIN');
  assert.equal(result.mapped, true);
  const opportunity = domain.get('FUNDING_OPPORTUNITY', 'FOR-AUDI-1');
  assert.equal(opportunity.transactionProfile.agreementNumber, 'PA-88421');
  assert.equal(opportunity.transactionProfile.vin, 'WA1TESTVIN1234567');
  assert.equal(opportunity.transactionProfile.vehicleMake, 'Audi');
  assert.equal(opportunity.transactionProfile.vehicleModel, 'Q5');
  assert.equal(opportunity.transactionProfile.purchasePrice, 48750);
  assert.equal(opportunity.transactionProfile.payeeName, 'Audi Dealer LLC');
  assert.equal(opportunity.transactionFacts[0].sourceDocument.documentId, 'DOC-AUDI-1');

  const asset = domain.get('ASSET_ACCOUNT', 'AST-AUDI-1');
  assert.equal(asset.metadata.vin, 'WA1TESTVIN1234567');
  assert.equal(asset.metadata.year, '2026');
  assert.equal(asset.metadata.make, 'Audi');
  assert.equal(asset.metadata.model, 'Q5');
  assert.equal(asset.metadata.sourceDocumentId, 'DOC-AUDI-1');
});
