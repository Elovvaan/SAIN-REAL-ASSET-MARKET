import test from 'node:test';
import assert from 'node:assert/strict';
import PDFKitDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import { AchSettlementPacketService } from '../services/ach-settlement-packet-service.js';

class Domain {
  constructor() { this.records = new Map(); this.database = null; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  put(type, id, record) { this.records.set(this.key(type, id), record); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
  }
}

async function sourcePdf(label) {
  const chunks = [];
  const doc = new PDFKitDocument({ size: 'LETTER' });
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  doc.fontSize(18).text(label);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

function documentService(records, bytes) {
  return {
    async initialize() {},
    get(id) { return records.get(id) || null; },
    async read(id) { return bytes.get(id) || null; },
  };
}

test('funding package encloses operative closing documents without reproducing underwriting evidence for account-based settlement', async () => {
  const domain = new Domain();
  domain.put('PARTICIPANT', 'P-1', { participantId: 'P-1', displayName: 'Acquiring Party' });
  domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1', applicantParticipantId: 'P-1', title: 'Operating Business Acquisition', purpose: 'Acquire operating business', supportingDocumentIds: ['DOC-AGREEMENT', 'DOC-PNL'],
  });
  domain.put('FUNDING_OPPORTUNITY_EVIDENCE', 'FOE-1', { evidenceId: 'FOE-1', opportunityId: 'FOR-1', evidenceType: 'FINANCIAL_STATEMENTS', documentId: 'DOC-PNL' });
  domain.put('FINANCING_CLOSING', 'FCL-1', {
    closingId: 'FCL-1', opportunityId: 'FOR-1', beneficiaryName: 'Selling Party', settlementMethod: 'ACH',
    documentaryEvidence: { documentReference: 'DOC-AGREEMENT', documentHash: 'a'.repeat(64), documentType: 'ASSET_PURCHASE_AGREEMENT' },
  });
  domain.put('EXPORT_PACKAGE', 'EXP-1', {
    exportPackageId: 'EXP-1', exportKind: 'FINANCING_DISBURSEMENT', financingTransactionId: 'LFA-1', closingId: 'FCL-1', opportunityId: 'FOR-1', borrowerParticipantId: 'P-1', beneficiaryName: 'Selling Party', preferredRail: 'ACH', amount: 3900000, currency: 'USD',
    documentaryEvidence: { documentReference: 'DOC-AGREEMENT', documentHash: 'a'.repeat(64), documentType: 'ASSET_PURCHASE_AGREEMENT' },
  });

  const records = new Map([
    ['DOC-AGREEMENT', { id: 'DOC-AGREEMENT', originalName: 'Asset Purchase Agreement.pdf', mimeType: 'application/pdf', documentType: 'ASSET_PURCHASE_AGREEMENT', sha256: 'a'.repeat(64), uploadedAt: '2026-08-30T12:00:00.000Z' }],
    ['DOC-PNL', { id: 'DOC-PNL', originalName: 'Historical P&L.pdf', mimeType: 'application/pdf', documentType: 'FINANCIAL_STATEMENTS', sha256: 'b'.repeat(64), uploadedAt: '2026-08-29T12:00:00.000Z' }],
  ]);
  const bytes = new Map([
    ['DOC-AGREEMENT', await sourcePdf('Executed Asset Purchase Agreement')],
    ['DOC-PNL', await sourcePdf('Historical Profit and Loss Statements')],
  ]);

  const service = new AchSettlementPacketService(domain, documentService(records, bytes));
  const data = service.source('EXP-1');
  assert.equal(data.vehicleModel, null);
  assert.equal(data.recipientName, 'Selling Party');
  assert.equal(data.settlementMethodLabel, 'ACH Credit');
  const packageDocuments = await service.linkedDocuments(data);
  assert.deepEqual(packageDocuments.map((record) => record.id), ['DOC-AGREEMENT']);
  const pdf = await service.renderFundingPackage('EXP-1');
  const assembled = await PDFLibDocument.load(pdf);
  assert.equal(assembled.getPageCount(), 5, 'cover + operative agreement + recipient instructions + settlement + servicing');
});

test('cash-item funding package contains only the SRA funding package and executed Funding Settlement Note', async () => {
  const domain = new Domain();
  domain.put('PARTICIPANT', 'P-2', { participantId: 'P-2', displayName: 'Purchasing Party' });
  domain.put('FUNDING_OPPORTUNITY', 'FOR-2', {
    opportunityId: 'FOR-2', applicantParticipantId: 'P-2', title: 'Vehicle Acquisition', purpose: 'Acquire vehicle', supportingDocumentIds: ['DOC-NOTE', 'DOC-AGREEMENT', 'DOC-PNL'],
  });
  domain.put('FINANCING_CLOSING', 'FCL-2', {
    closingId: 'FCL-2', opportunityId: 'FOR-2', beneficiaryName: 'Dealer Payee', settlementMethod: 'CASH_ITEM_COLLECTION',
    documentaryEvidence: { documentReference: 'DOC-AGREEMENT', documentHash: 'c'.repeat(64), documentType: 'ASSET_PURCHASE_AGREEMENT' },
    settlementInstructions: { packageDocumentIds: ['DOC-NOTE', 'DOC-AGREEMENT'] },
  });
  domain.put('EXPORT_PACKAGE', 'EXP-2', {
    exportPackageId: 'EXP-2', exportKind: 'FINANCING_DISBURSEMENT', financingTransactionId: 'LFA-2', closingId: 'FCL-2', opportunityId: 'FOR-2', borrowerParticipantId: 'P-2', beneficiaryName: 'Dealer Payee', preferredRail: 'CASH_ITEM_COLLECTION', amount: 60000, currency: 'USD',
    documentaryEvidence: { documentReference: 'DOC-AGREEMENT', documentHash: 'c'.repeat(64), documentType: 'ASSET_PURCHASE_AGREEMENT' },
    settlementInstructions: { packageDocumentIds: ['DOC-NOTE', 'DOC-AGREEMENT'] },
  });

  const records = new Map([
    ['DOC-NOTE', { id: 'DOC-NOTE', originalName: 'SRA Funding Settlement Note.pdf', mimeType: 'application/pdf', documentType: 'FUNDING_SETTLEMENT_NOTE', sha256: 'n'.repeat(64), uploadedAt: '2026-09-09T12:00:00.000Z' }],
    ['DOC-AGREEMENT', { id: 'DOC-AGREEMENT', originalName: 'Purchase Agreement.pdf', mimeType: 'application/pdf', documentType: 'ASSET_PURCHASE_AGREEMENT', sha256: 'c'.repeat(64), uploadedAt: '2026-09-08T12:00:00.000Z' }],
    ['DOC-PNL', { id: 'DOC-PNL', originalName: 'Financial Statements.pdf', mimeType: 'application/pdf', documentType: 'FINANCIAL_STATEMENTS', sha256: 'd'.repeat(64), uploadedAt: '2026-09-07T12:00:00.000Z' }],
  ]);
  const bytes = new Map([
    ['DOC-NOTE', await sourcePdf('SRA Funding Settlement Note - Payable on Demand')],
    ['DOC-AGREEMENT', await sourcePdf('Executed Purchase Agreement')],
    ['DOC-PNL', await sourcePdf('Underwriting Financial Statements')],
  ]);

  const service = new AchSettlementPacketService(domain, documentService(records, bytes));
  const data = service.source('EXP-2');
  assert.equal(data.cashItemCollection, true);
  assert.equal(data.recipientName, 'Dealer Payee');
  const linkedDocuments = await service.linkedDocuments(data);
  assert.deepEqual(linkedDocuments.map((record) => record.id), ['DOC-NOTE', 'DOC-AGREEMENT']);
  const pdf = await service.renderFundingPackage('EXP-2');
  const assembled = await PDFLibDocument.load(pdf);
  assert.equal(assembled.getPageCount(), 2, 'SRA funding package + executed Funding Settlement Note only');
});
