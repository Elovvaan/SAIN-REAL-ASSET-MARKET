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

test('funding package encloses operative closing documents without reproducing underwriting evidence', async () => {
  const domain = new Domain();
  domain.put('PARTICIPANT', 'P-1', {
    participantId: 'P-1',
    displayName: 'Acquiring Party',
  });
  domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1',
    applicantParticipantId: 'P-1',
    title: 'Operating Business Acquisition',
    purpose: 'Acquire operating business',
    supportingDocumentIds: ['DOC-AGREEMENT', 'DOC-PNL'],
  });
  domain.put('FUNDING_OPPORTUNITY_EVIDENCE', 'FOE-1', {
    evidenceId: 'FOE-1',
    opportunityId: 'FOR-1',
    evidenceType: 'FINANCIAL_STATEMENTS',
    documentId: 'DOC-PNL',
  });
  domain.put('FINANCING_CLOSING', 'FCL-1', {
    closingId: 'FCL-1',
    opportunityId: 'FOR-1',
    beneficiaryName: 'Selling Party',
    settlementMethod: 'ACH',
    documentaryEvidence: {
      documentReference: 'DOC-AGREEMENT',
      documentHash: 'a'.repeat(64),
      documentType: 'ASSET_PURCHASE_AGREEMENT',
    },
  });
  domain.put('EXPORT_PACKAGE', 'EXP-1', {
    exportPackageId: 'EXP-1',
    exportKind: 'FINANCING_DISBURSEMENT',
    financingTransactionId: 'LFA-1',
    closingId: 'FCL-1',
    opportunityId: 'FOR-1',
    borrowerParticipantId: 'P-1',
    beneficiaryName: 'Selling Party',
    preferredRail: 'ACH',
    amount: 3900000,
    currency: 'USD',
    documentaryEvidence: {
      documentReference: 'DOC-AGREEMENT',
      documentHash: 'a'.repeat(64),
      documentType: 'ASSET_PURCHASE_AGREEMENT',
    },
  });

  const agreementPdf = await sourcePdf('Executed Asset Purchase Agreement');
  const pnlPdf = await sourcePdf('Historical Profit and Loss Statements');
  const records = new Map([
    ['DOC-AGREEMENT', {
      id: 'DOC-AGREEMENT',
      originalName: 'Asset Purchase Agreement.pdf',
      mimeType: 'application/pdf',
      documentType: 'ASSET_PURCHASE_AGREEMENT',
      sha256: 'a'.repeat(64),
      uploadedAt: '2026-08-30T12:00:00.000Z',
    }],
    ['DOC-PNL', {
      id: 'DOC-PNL',
      originalName: 'Historical P&L.pdf',
      mimeType: 'application/pdf',
      documentType: 'FINANCIAL_STATEMENTS',
      sha256: 'b'.repeat(64),
      uploadedAt: '2026-08-29T12:00:00.000Z',
    }],
  ]);
  const bytes = new Map([
    ['DOC-AGREEMENT', agreementPdf],
    ['DOC-PNL', pnlPdf],
  ]);
  const documents = {
    async initialize() {},
    get(id) { return records.get(id) || null; },
    async read(id) { return bytes.get(id) || null; },
  };

  const service = new AchSettlementPacketService(domain, documents);
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
