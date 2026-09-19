import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(__dirname, '..', 'SRA LOGO.png');

function value(...values) {
  return values.find((item) => item !== null && item !== undefined && String(item).trim() !== '') || null;
}
function label(input) { return String(input || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function date(input) { const parsed = new Date(input); return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); }
function money(amount, currency = 'USD') { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(amount || 0)); }
function field(doc, name, contents, x, y, width) {
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#4b5563').text(name.toUpperCase(), x, y, { width });
  doc.font('Helvetica').fontSize(9).fillColor('#111827').text(String(contents ?? '—'), x, y + 11, { width, height: 25, ellipsis: true });
}
function rule(doc, y, dashed = false) {
  if (dashed) doc.dash(4, { space: 4 });
  doc.moveTo(36, y).lineTo(576, y).lineWidth(0.7).strokeColor('#9ca3af').stroke();
  doc.undash();
}
function printMarks(doc) {
  for (const y of [264, 528]) {
    doc.moveTo(20, y).lineTo(32, y).strokeColor('#111827').lineWidth(0.6).stroke();
    doc.moveTo(580, y).lineTo(592, y).stroke();
  }
}

export class CheckStockInstrumentDocumentService {
  constructor(domain) { this.domain = domain; }

  source(instrumentId) {
    const instrument = this.domain.get('SRA_INSTRUMENT', instrumentId);
    if (!instrument) throw new Error('Instrument was not found.');
    if (instrument.issuanceStatus !== 'ISSUED') throw new Error('Instrument document is available after issuance.');
    const transaction = instrument.issuanceTransactionId ? this.domain.get('SRA_TRANSACTION', instrument.issuanceTransactionId) : null;
    const opportunity = instrument.opportunityId ? this.domain.get('FUNDING_OPPORTUNITY', instrument.opportunityId) : null;
    const participantId = value(instrument.issuerParticipantId, transaction?.issuerParticipantId, opportunity?.applicantParticipantId);
    const participant = participantId ? this.domain.get('PARTICIPANT', participantId) : null;
    return { instrument, transaction, opportunity, participant };
  }

  async render(instrumentId, { printReady = false } = {}) {
    const { instrument, transaction, opportunity, participant } = this.source(instrumentId);
    const currency = value(transaction?.currency, instrument.currency, 'USD');
    const faceValue = value(transaction?.amount, instrument.faceValue, instrument.requestedAmount, 0);
    const terms = instrument.terms || {};
    const issuer = value(participant?.metadata?.legalName, participant?.displayName, opportunity?.applicantDisplayName, instrument.issuerParticipantId, '—');
    const payee = value(terms.payeeName, terms.beneficiaryName, opportunity?.transactionProfile?.payeeName, '—');
    const paymentOffice = value(terms.draweeName, terms.payingAgentName, terms.servicingOffice, '—');
    const reference = value(terms.fundingReference, transaction?.transactionId, instrument.instrumentId);
    const chunks = [];
    const doc = new PDFDocument({ size: 'LETTER', margin: 36, bufferPages: true, info: { Title: `${instrument.instrumentId} Issued Instrument`, Subject: 'SRA issued instrument — check-stock presentation' } });
    doc.on('data', (chunk) => chunks.push(chunk));
    const completed = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

    if (printReady) printMarks(doc);
    if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, 40, 26, { fit: [52, 52] });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151').text('SAIN REAL ASSET MARKET', 102, 30);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text(label(instrument.instrumentFamily || 'Financial Instrument'), 102, 42, { width: 300 });
    doc.font('Helvetica-Bold').fontSize(8).text(`INSTRUMENT NO. ${instrument.instrumentId}`, 420, 30, { width: 156, align: 'right' });
    doc.font('Helvetica').fontSize(8).text(`ISSUE DATE  ${date(transaction?.issueDate || instrument.issueDate)}`, 420, 44, { width: 156, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(14).text(money(faceValue, currency), 420, 60, { width: 156, align: 'right' });
    rule(doc, 92);
    field(doc, 'Issued by', issuer, 42, 106, 245);
    field(doc, 'Payee / beneficiary', payee, 315, 106, 245);
    field(doc, 'Face value', money(faceValue, currency), 42, 150, 160);
    field(doc, 'Maturity', transaction?.maturityDate ? date(transaction.maturityDate) : value(terms.maturity, '—'), 220, 150, 160);
    field(doc, 'Settlement rule', label(value(transaction?.settlementRule, instrument.settlementRule, '—')), 398, 150, 162);
    field(doc, 'Purpose', value(instrument.purpose, opportunity?.purpose, opportunity?.title, '—'), 42, 194, 518);
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(`Recorded instrument terms · ${instrument.instrumentId} · ${transaction?.transactionId || 'issuance transaction pending'}`, 42, 244, { width: 518 });

    rule(doc, 264, true);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text('PRESENTMENT / SETTLEMENT ROUTING', 42, 280);
    field(doc, 'Drawee / paying agent / servicing office', paymentOffice, 42, 302, 250);
    field(doc, 'Funding / transaction reference', reference, 315, 302, 245);
    field(doc, 'Governing document ID', value(transaction?.governingDocumentId, instrument.governingDocumentId, '—'), 42, 350, 250);
    field(doc, 'Verified value reference', value(instrument.canonicalVerifiedValueRecordId, instrument.verifiedRecordId, '—'), 315, 350, 245);
    field(doc, 'Institutional delivery details', value(terms.presentmentInstructions, terms.deliveryInstructions, terms.processingContact, 'Recorded with transaction file'), 42, 398, 518);
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text('Use the instrument number and transaction reference for presentment, settlement processing, and record matching.', 42, 475, { width: 518 });

    rule(doc, 528, true);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text('ISSUER / TRANSACTION RECORD', 42, 544);
    field(doc, 'Instrument ID', instrument.instrumentId, 42, 568, 245);
    field(doc, 'Issuance transaction ID', transaction?.transactionId || instrument.issuanceTransactionId, 315, 568, 245);
    field(doc, 'Instrument family', label(instrument.instrumentFamily), 42, 612, 245);
    field(doc, 'Status', `${instrument.issuanceStatus} · ${instrument.status}`, 315, 612, 245);
    field(doc, 'Opportunity', value(opportunity?.title, instrument.opportunityId, '—'), 42, 656, 245);
    field(doc, 'Issued by / issued at', `${value(instrument.issuedBy, '—')} · ${date(instrument.issuedAt)}`, 315, 656, 245);
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(`Presentation: SRA CHECK STOCK V1 · ${printReady ? 'PRINT-READY' : 'DIGITAL'} · content derived from the issued instrument record`, 42, 738, { width: 518, align: 'center' });
    doc.end();
    return completed;
  }
}
