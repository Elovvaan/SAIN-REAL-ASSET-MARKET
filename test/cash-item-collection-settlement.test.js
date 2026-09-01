import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import { AchSettlementPacketService } from '../services/ach-settlement-packet-service.js';

class Domain {
  constructor() { this.records = new Map(); this.database = null; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  put(type, id, record) { this.records.set(this.key(type, id), record); }
}

function fixture() {
  const domain = new Domain();
  domain.put('PARTICIPANT', 'P-1', { participantId: 'P-1', displayName: 'House Morris Trust' });
  domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1',
    applicantParticipantId: 'P-1',
    transactionProfile: {
      purchaserName: 'House Morris Trust',
      payeeName: 'Young Volkswagen of Layton',
      paymentPurpose: 'Vehicle purchase settlement',
      purchasePrice: 79456.17,
    },
  });
  domain.put('FINANCING_CLOSING', 'FCL-1', {
    closingId: 'FCL-1',
    opportunityId: 'FOR-1',
    beneficiaryName: 'Young Volkswagen of Layton',
    settlementMethod: 'CASH_ITEM_COLLECTION',
    settlementInstructions: {},
  });
  domain.put('EXPORT_PACKAGE', 'EXP-1', {
    exportPackageId: 'EXP-1',
    exportKind: 'FINANCING_DISBURSEMENT',
    financingTransactionId: 'LFA-1',
    closingId: 'FCL-1',
    opportunityId: 'FOR-1',
    borrowerParticipantId: 'P-1',
    beneficiaryName: 'Young Volkswagen of Layton',
    amount: 79456.17,
    currency: 'USD',
    preferredRail: 'CASH_ITEM_COLLECTION',
    settlementInstructions: {},
  });
  const documents = { async initialize() {}, get() { return null; }, async read() { return null; } };
  return { domain, documents };
}

test('cash item collection is a first-class settlement method without recipient banking credentials', async () => {
  const { domain, documents } = fixture();
  const service = new AchSettlementPacketService(domain, documents);
  const source = service.source('EXP-1');
  assert.equal(source.settlementMethod, 'CASH_ITEM_COLLECTION');
  assert.equal(source.settlementMethodLabel, 'Cash Item Collection');
  assert.equal(source.cashItemCollection, true);

  const instructions = await service.renderDealerProcessingInstructions('EXP-1');
  const settlement = await service.renderSettlementPage('EXP-1');
  assert.equal(instructions.subarray(0, 4).toString(), '%PDF');
  assert.equal(settlement.subarray(0, 4).toString(), '%PDF');

  const packageBytes = await service.renderFundingPackage('EXP-1');
  const packagePdf = await PDFLibDocument.load(packageBytes);
  assert.equal(packagePdf.getPageCount(), 4, 'cover + cash-item instructions + collection confirmation + servicing');
});

test('admin closing flow exposes Cash Item Collection alongside existing rails', () => {
  const source = fs.readFileSync(new URL('../public/admin/admin-financing-awaiting-actions.js', import.meta.url), 'utf8');
  assert.match(source, /value="CASH_ITEM_COLLECTION"/);
  assert.match(source, />Cash Item Collection</);
  assert.match(source, /value="ACH"/);
  assert.match(source, /value="FEDWIRE"/);
  assert.match(source, /value="BANK_WIRE"/);
});
