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

test('financing export package assembles the three-document funding layer with linked transaction documents', async () => {
  const domain = new Domain();
  domain.put('PARTICIPANT', 'P-1', {
    participantId: 'P-1',
    displayName: 'House Morris Trust',
  });
  domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1',
    applicantParticipantId: 'P-1',
    title: '2026 Audi Q5',
    supportingDocumentIds: ['DOC-PURCHASE-1'],
    transactionProfile: {
      purchaserName: 'House Morris Trust',
      payeeName: 'Example Audi Dealer',
      vehicleYear: '2026',
      vehicleMake: 'Audi',
      vehicleModel: 'Q5',
      vin: 'WA1EXAMPLE1234567',
      agreementNumber: 'PA-7788',
      purchasePrice: 50000,
      sourceDocumentId: 'DOC-PURCHASE-1',
      sourceDocumentSha256: 'a'.repeat(64),
      repaymentTerms: {
        paymentFrequency: 'Monthly',
        paymentAmount: 850,
        firstPaymentDate: '2026-09-27T00:00:00.000Z',
        maturityDate: '2032-08-27T00:00:00.000Z',
        paymentMethod: 'ACH Credit',
      },
      servicing: {
        servicingReference: 'SRV-LFA-1',
        paymentDestination: 'Recorded SRA servicing destination',
        contact: 'SRA Servicing',
      },
    },
  });
  domain.put('FUNDING_OPPORTUNITY_EVIDENCE', 'FOE-1', {
    evidenceId: 'FOE-1',
    opportunityId: 'FOR-1',
    documentId: 'DOC-PURCHASE-1',
    evidenceType: 'PURCHASE_AGREEMENT',
  });
  domain.put('FINANCING_CLOSING', 'FCL-1', {
    closingId: 'FCL-1',
    opportunityId: 'FOR-1',
    beneficiaryName: 'Example Audi Dealer',
    conditions: [{
      conditionId: 'C-1',
      title: 'Executed purchase agreement',
      status: 'SATISFIED',
    }],
    documentaryEvidence: {
      documentReference: 'DOC-PURCHASE-1',
      documentSha256: 'a'.repeat(64),
      signatureEvidenceReference: 'SIG-1',
      auditTrailReference: 'AUD-1',
    },
  });
  domain.put('EXPORT_PACKAGE', 'EXP-1', {
    exportPackageId: 'EXP-1',
    exportKind: 'FINANCING_DISBURSEMENT',
    financingTransactionId: 'LFA-1',
    closingId: 'FCL-1',
    opportunityId: 'FOR-1',
    borrowerParticipantId: 'P-1',
    beneficiaryName: 'Example Audi Dealer',
    amount: 50000,
    currency: 'USD',
    documentaryEvidence: {
      documentReference: 'DOC-PURCHASE-1',
      documentSha256: 'a'.repeat(64),
      signatureEvidenceReference: 'SIG-1',
      auditTrailReference: 'AUD-1',
    },
  });

  const purchaseAgreementPdf = await sourcePdf('Executed Vehicle Purchase Agreement');
  const documentRecord = {
    id: 'DOC-PURCHASE-1',
    originalName: 'Audi Purchase Agreement.pdf',
    mimeType: 'application/pdf',
    documentType: 'PURCHASE_AGREEMENT',
    sha256: 'a'.repeat(64),
    uploadedAt: '2026-08-22T12:00:00.000Z',
    extraction: {
      status: 'EXTRACTED',
      facts: { documentType: 'VEHICLE_PURCHASE_AGREEMENT' },
    },
  };
  const documents = {
    async initialize() {},
    get(id) { return id === documentRecord.id ? documentRecord : null; },
    async read(id) { return id === documentRecord.id ? purchaseAgreementPdf : null; },
  };

  const service = new AchSettlementPacketService(domain, documents);
  const source = service.source('EXP-1');
  assert.equal(source.purchaserName, 'House Morris Trust');
  assert.equal(source.dealershipName, 'Example Audi Dealer');
  assert.equal(source.vehicleMake, 'Audi');
  assert.equal(source.vehicleModel, 'Q5');
  assert.equal(source.vin, 'WA1EXAMPLE1234567');
  assert.equal(source.agreementNumber, 'PA-7788');

  const servicing = service.servicingData(source);
  assert.equal(servicing.servicingReference, 'SRV-LFA-1');
  assert.equal(servicing.paymentFrequency, 'Monthly');
  assert.equal(servicing.scheduledPaymentAmount, 850);
  assert.equal(servicing.paymentMethod, 'ACH Credit');

  const dealerInstructions = await service.renderDealerProcessingInstructions('EXP-1');
  assert.ok(Buffer.isBuffer(dealerInstructions));
  assert.equal(dealerInstructions.subarray(0, 4).toString(), '%PDF');

  const settlement = await service.renderSettlementPage('EXP-1');
  assert.ok(Buffer.isBuffer(settlement));
  assert.equal(settlement.subarray(0, 4).toString(), '%PDF');

  const servicingInstructions = await service.renderServicingInstructions('EXP-1');
  assert.ok(Buffer.isBuffer(servicingInstructions));
  assert.equal(servicingInstructions.subarray(0, 4).toString(), '%PDF');

  const pdf = await service.render('EXP-1');
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > purchaseAgreementPdf.length);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');

  const assembled = await PDFLibDocument.load(pdf);
  assert.ok(
    assembled.getPageCount() >= 5,
    'funding cover + source agreement + dealer instructions + settlement page + servicing instructions should be present',
  );
});
