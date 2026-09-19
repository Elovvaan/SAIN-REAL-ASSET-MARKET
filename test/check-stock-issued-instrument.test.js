import test from 'node:test';
import assert from 'node:assert/strict';
import { CheckStockInstrumentDocumentService } from '../services/check-stock-instrument-document-service.js';

test('issued instruments render as digital and print-ready check-stock PDFs', async () => {
  const records = new Map([
    ['SRA_INSTRUMENT:I-100', { instrumentId: 'I-100', instrumentFamily: 'ASSET_BACKED_NOTE', issuanceStatus: 'ISSUED', status: 'ACTIVE', issuanceTransactionId: 'TX-100', issuerParticipantId: 'P-100', opportunityId: 'O-100', faceValue: 500000, currency: 'USD', settlementRule: 'AT_MATURITY', governingDocumentId: 'DOC-100', verifiedRecordId: 'VR-100', issuedBy: 'ADMIN-1', issuedAt: '2026-09-19T00:00:00.000Z' }],
    ['SRA_TRANSACTION:TX-100', { transactionId: 'TX-100', amount: 500000, currency: 'USD', issueDate: '2026-09-19T00:00:00.000Z' }],
    ['PARTICIPANT:P-100', { displayName: 'Example Infrastructure Holdings' }],
    ['FUNDING_OPPORTUNITY:O-100', { title: 'Infrastructure acquisition' }],
  ]);
  const domain = { get(type, id) { return records.get(`${type}:${id}`) || null; } };
  const renderer = new CheckStockInstrumentDocumentService(domain);
  for (const printReady of [false, true]) {
    const pdf = await renderer.render('I-100', { printReady });
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 3000);
  }
});

test('draft instruments do not produce an issued document', async () => {
  const domain = { get(type) { return type === 'SRA_INSTRUMENT' ? { instrumentId: 'I-DRAFT', issuanceStatus: 'NOT_ISSUED' } : null; } };
  await assert.rejects(() => new CheckStockInstrumentDocumentService(domain).render('I-DRAFT'), /available after issuance/);
});
