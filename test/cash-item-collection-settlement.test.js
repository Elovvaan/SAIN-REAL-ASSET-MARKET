import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PDFKitDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import { AchSettlementPacketService } from '../services/ach-settlement-packet-service.js';

class Domain {
  constructor() { this.records = new Map(); this.database = null; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  put(type, id, record) { this.records.set(this.key(type, id), record); }
}

async function sourcePdf(label) {
  const chunks = [];
  const doc = new PDFKitDocument({ size: 'LETTER' });
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });
  doc.fontSize(18).text(label);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

async function fixture({ includeNote = true } = {}) {
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
    closingId: 'FCL-1', opportunityId: 'FOR-1', beneficiaryName: 'Young Volkswagen of Layton',
    settlementMethod: 'CASH_ITEM_COLLECTION',
    settlementInstructions: { packageDocumentIds: includeNote ? ['DOC-NOTE-1'] : [] },
  });
  domain.put('EXPORT_PACKAGE', 'EXP-1', {
    exportPackageId: 'EXP-1', exportKind: 'FINANCING_DISBURSEMENT', financingTransactionId: 'LFA-1',
    closingId: 'FCL-1', opportunityId: 'FOR-1', borrowerParticipantId: 'P-1',
    beneficiaryName: 'Young Volkswagen of Layton', amount: 79456.17, currency: 'USD',
    preferredRail: 'CASH_ITEM_COLLECTION',
    settlementInstructions: { packageDocumentIds: includeNote ? ['DOC-NOTE-1'] : [] },
  });
  const noteBytes = await sourcePdf('Executed SRA Funding Settlement Note');
  const note = {
    id: 'DOC-NOTE-1', originalName: 'SRA Funding Settlement Note - EXECUTED.pdf',
    mimeType: 'application/pdf', documentType: 'FUNDING_SETTLEMENT_NOTE', sha256: 'a'.repeat(64),
    extraction: { status: 'EXTRACTED', facts: { documentType: 'FUNDING_SETTLEMENT_NOTE' } },
  };
  const documents = {
    async initialize() {},
    get(id) { return includeNote && id === note.id ? note : null; },
    async read(id) { return includeNote && id === note.id ? noteBytes : null; },
  };
  return { domain, documents };
}

test('cash item collection requires and includes the funding settlement note', async () => {
  const { domain, documents } = await fixture();
  const service = new AchSettlementPacketService(domain, documents);
  const source = service.source('EXP-1');
  assert.equal(source.settlementMethod, 'CASH_ITEM_COLLECTION');
  assert.equal(source.cashItemCollection, true);
  const packageBytes = await service.renderFundingPackage('EXP-1');
  const packagePdf = await PDFLibDocument.load(packageBytes);
  assert.equal(packagePdf.getPageCount(), 5, 'cover + executed note + instructions + collection confirmation + servicing');
});

test('cash item collection rejects package generation when the required funding settlement note is missing', async () => {
  const { domain, documents } = await fixture({ includeNote: false });
  const service = new AchSettlementPacketService(domain, documents);
  await assert.rejects(
    () => service.renderFundingPackage('EXP-1'),
    /executed SRA Funding Settlement Note is required/i,
  );
});

test('admin closing flow exposes Cash Item Collection alongside existing rails', () => {
  const source = fs.readFileSync(new URL('../public/admin/admin-financing-awaiting-actions.js', import.meta.url), 'utf8');
  assert.match(source, /value="CASH_ITEM_COLLECTION"/);
  assert.match(source, />Cash Item Collection</);
  assert.match(source, /value="ACH"/);
  assert.match(source, /value="FEDWIRE"/);
  assert.match(source, /value="BANK_WIRE"/);
});
