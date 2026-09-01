import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFKitDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import { PrivateDocumentService } from './private-document-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLATFORM_LOGO_PATH = path.resolve(__dirname, '..', 'SRA LOGO.png');

function text(value) { return value == null || value === '' ? null : String(value).trim(); }
function money(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}
function dateLabel(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function first(...values) {
  for (const value of values) if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  return null;
}
function line(doc, label, value, options = {}) {
  const y = doc.y;
  const labelWidth = options.labelWidth || 175;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text(label, 54, y, { width: labelWidth });
  doc.font('Helvetica').fontSize(9).fillColor('#000000').text(value || '______________________________________________', 54 + labelWidth, y, { width: 330 });
  doc.moveDown(0.8);
}
function section(doc, title) {
  doc.moveDown(0.55);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text(title);
  doc.moveDown(0.35);
}
function rule(doc) {
  const y = doc.y;
  doc.moveTo(54, y).lineTo(558, y).strokeColor('#b9b9b9').lineWidth(0.6).stroke();
  doc.moveDown(0.6);
}
function drawPlatformLogo(doc) {
  if (!fs.existsSync(PLATFORM_LOGO_PATH)) return;
  const width = 82;
  const x = (612 - width) / 2;
  const y = doc.y;
  doc.image(PLATFORM_LOGO_PATH, x, y, { fit: [width, 82], align: 'center' });
  doc.y = y + 88;
}
function unique(values = []) { return [...new Set(values.filter(Boolean))]; }
function documentType(record) { return first(record?.extraction?.facts?.documentType, record?.documentType, 'TRANSACTION_DOCUMENT'); }
function documentPriority(record) {
  const value = String(documentType(record) || '').toUpperCase();
  if (/PURCHASE_AGREEMENT|ACQUISITION_AGREEMENT|ASSET_PURCHASE|SALES_CONTRACT|LOAN_AGREEMENT|PROMISSORY_NOTE|SECURITY_AGREEMENT|GUARANTY|ASSIGNMENT|CONSENT|CONTRACT/.test(value)) return 10;
  if (/AUTHORIZATION|SIGNATURE|CLOSING/.test(value)) return 20;
  return 100;
}
function instruction(doc, number, body) {
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text(`${number}.`, 54, y, { width: 20 });
  doc.font('Helvetica').fontSize(9).fillColor('#000000').text(body, 76, y, { width: 482, lineGap: 1.5 });
  doc.moveDown(0.55);
}
function normalizeSettlementMethod(value) { return String(value || '').trim().toUpperCase(); }
function isCashItemCollection(value) { return normalizeSettlementMethod(value) === 'CASH_ITEM_COLLECTION'; }
function settlementMethodLabel(value) {
  const method = normalizeSettlementMethod(value);
  if (method === 'ACH' || method === 'ACH_CREDIT') return 'ACH Credit';
  if (method === 'FEDWIRE') return 'Fedwire';
  if (method === 'BANK_WIRE' || method === 'WIRE') return 'Bank Wire';
  if (method === 'CASH_ITEM_COLLECTION') return 'Cash Item Collection';
  return method ? method.replaceAll('_', ' ') : 'Settlement';
}

export class AchSettlementPacketService {
  constructor(domain, documentService = null) {
    this.domain = domain;
    this.documents = documentService || new PrivateDocumentService({ database: domain?.database || null });
  }

  source(exportPackageId) {
    const pkg = this.domain.get('EXPORT_PACKAGE', exportPackageId);
    if (!pkg) throw new Error('Financing export package was not found.');
    if (pkg.exportKind !== 'FINANCING_DISBURSEMENT') throw new Error('Export package is not a financing disbursement package.');
    const closing = pkg.closingId ? this.domain.get('FINANCING_CLOSING', pkg.closingId) : null;
    const opportunity = pkg.opportunityId ? this.domain.get('FUNDING_OPPORTUNITY', pkg.opportunityId) : null;
    const participantId = pkg.borrowerParticipantId || pkg.participantId || opportunity?.applicantParticipantId || null;
    const participant = participantId ? this.domain.get('PARTICIPANT', participantId) : null;
    const evidence = pkg.documentaryEvidence || closing?.documentaryEvidence || {};
    const profile = opportunity?.transactionProfile || {};
    const relatedAssetId = Array.isArray(opportunity?.relatedAssetIds) ? opportunity.relatedAssetIds[0] : null;
    const asset = relatedAssetId ? this.domain.get('ASSET_ACCOUNT', relatedAssetId) : null;
    const assetMeta = asset?.metadata || asset?.details || {};
    const opportunityMeta = opportunity?.metadata || {};
    const recipientName = first(profile.payeeName, pkg.beneficiaryName, closing?.beneficiaryName);
    const settlementMethod = first(pkg.selectedRail, pkg.preferredRail, pkg.settlementMethod, closing?.settlementMethod, profile.settlementMethod);
    return {
      pkg, closing, opportunity, participant, evidence, profile,
      purchaserName: first(profile.purchaserName, participant?.displayName, participant?.metadata?.legalName, opportunity?.applicantDisplayName, participantId),
      recipientName, beneficiaryName: recipientName, dealershipName: recipientName,
      settlementMethod, settlementMethodLabel: settlementMethodLabel(settlementMethod),
      cashItemCollection: isCashItemCollection(settlementMethod),
      vehicleYear: first(profile.vehicleYear, assetMeta.year, opportunityMeta.vehicleYear, opportunity?.vehicleYear),
      vehicleMake: first(profile.vehicleMake, assetMeta.make, opportunityMeta.vehicleMake, opportunity?.vehicleMake),
      vehicleModel: first(profile.vehicleModel, assetMeta.model, opportunityMeta.vehicleModel, opportunity?.vehicleModel),
      vin: first(profile.vin, assetMeta.vin, assetMeta.VIN, opportunityMeta.vin, opportunityMeta.VIN, opportunity?.vin, opportunity?.VIN),
      agreementNumber: first(profile.agreementNumber, evidence.agreementNumber),
      sourceDocumentId: first(profile.sourceDocumentId, evidence.documentReference),
      sourceDocumentSha256: first(profile.sourceDocumentSha256, evidence.documentHash, evidence.documentSha256),
      purchasePrice: first(profile.purchasePrice, pkg.amount),
      transactionPurpose: first(profile.paymentPurpose, profile.transactionPurpose, opportunity?.purpose, opportunity?.description, 'Transaction settlement'),
    };
  }

  servicingData(data) {
    const { pkg, closing, opportunity, profile } = data;
    const servicing = first(pkg.servicing, closing?.servicing, opportunity?.servicing, profile?.servicing) || {};
    const terms = first(pkg.repaymentTerms, closing?.repaymentTerms, opportunity?.repaymentTerms, profile?.repaymentTerms, servicing?.repaymentTerms) || {};
    return {
      servicingReference: first(servicing.servicingReference, servicing.reference, pkg.servicingReference, closing?.servicingReference, pkg.financingTransactionId),
      paymentFrequency: first(terms.paymentFrequency, terms.frequency, servicing.paymentFrequency, profile.paymentFrequency),
      scheduledPaymentAmount: first(terms.paymentAmount, terms.scheduledPaymentAmount, servicing.scheduledPaymentAmount, profile.scheduledPaymentAmount),
      firstPaymentDate: first(terms.firstPaymentDate, servicing.firstPaymentDate, profile.firstPaymentDate),
      maturityDate: first(terms.maturityDate, servicing.maturityDate, profile.maturityDate),
      paymentMethod: first(terms.paymentMethod, servicing.paymentMethod, profile.servicingPaymentMethod),
      paymentDestination: first(servicing.paymentDestination, servicing.destinationReference, profile.servicingPaymentDestination),
      paymentReference: first(servicing.paymentReference, pkg.financingTransactionId, pkg.exportPackageId),
      contact: first(servicing.contact, servicing.processingContact, profile.servicingContact),
    };
  }

  linkedDocumentIds(data) {
    const pkgInstructions = data.pkg?.settlementInstructions || {};
    const closingInstructions = data.closing?.settlementInstructions || {};
    return unique([
      ...(Array.isArray(pkgInstructions.packageDocumentIds) ? pkgInstructions.packageDocumentIds : []),
      ...(Array.isArray(closingInstructions.packageDocumentIds) ? closingInstructions.packageDocumentIds : []),
      data.evidence?.documentReference,
    ]);
  }

  async linkedDocuments(data) {
    await this.documents.initialize();
    const records = [];
    for (const id of this.linkedDocumentIds(data)) {
      const record = this.documents.get(id);
      if (record) records.push(record);
    }
    return records.sort((a, b) => documentPriority(a) - documentPriority(b) || String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
  }

  createDocument(title) {
    const chunks = [];
    const doc = new PDFKitDocument({ size: 'LETTER', margins: { top: 42, bottom: 42, left: 54, right: 54 }, info: { Title: title } });
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });
    return { doc, chunks, done };
  }

  async finishDocument(doc, chunks, done) { doc.end(); await done; return Buffer.concat(chunks); }

  async renderCover(data, packageDocuments) {
    const { pkg, closing } = data;
    const { doc, chunks, done } = this.createDocument(`SRA Funding Package ${pkg.exportPackageId}`);
    drawPlatformLogo(doc);
    doc.font('Helvetica-Bold').fontSize(16).text('FUNDING / SETTLEMENT PACKAGE', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Transaction Closing and Settlement Documents', { align: 'center' });
    doc.moveDown(0.8); rule(doc);
    line(doc, 'SRA Transaction ID', pkg.financingTransactionId || pkg.exportPackageId);
    line(doc, 'Funding Package Reference', pkg.exportPackageId);
    line(doc, 'Package Date', dateLabel(new Date().toISOString()));
    line(doc, 'Settlement Method', data.settlementMethodLabel);
    section(doc, 'Transaction Summary');
    line(doc, 'Purchaser / Obligated Party', data.purchaserName);
    line(doc, 'Beneficiary / Payee', data.recipientName);
    const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ');
    if (vehicle || data.vin) { line(doc, 'Vehicle', vehicle || null); line(doc, 'VIN', data.vin); }
    line(doc, 'Agreement / Contract No.', data.agreementNumber);
    line(doc, 'Transaction Amount', money(data.purchasePrice, pkg.currency || 'USD'));
    line(doc, 'Authorized Settlement Amount', money(pkg.amount, pkg.currency || 'USD'));
    line(doc, 'Financing Closing Reference', closing?.closingId || pkg.closingId || null);
    section(doc, 'Package Document Manifest');
    if (!packageDocuments.length) {
      doc.font('Helvetica').fontSize(9).text('No external transaction document is enclosed. Underwriting and supporting evidence remain retained in the SRA transaction record.');
    } else {
      packageDocuments.forEach((record, index) => {
        doc.font('Helvetica-Bold').fontSize(9).text(`${index + 1}. ${text(documentType(record)) || 'Transaction Document'}`);
        doc.font('Helvetica').fontSize(8).text(`${record.originalName || record.id}  |  ${record.id}  |  SHA-256 ${record.sha256 || 'not recorded'}`, { indent: 12 });
        doc.moveDown(0.35);
      });
    }
    if (Array.isArray(closing?.conditions) && closing.conditions.length) {
      section(doc, 'Recorded Closing Requirements');
      closing.conditions.filter((condition) => String(condition.status || '').toUpperCase() !== 'CANCELLED').forEach((condition) => {
        const status = String(condition.status || 'OPEN').toUpperCase();
        const description = first(condition.description, condition.requirement, condition.title, 'Closing requirement');
        doc.font('Helvetica').fontSize(8.5).text(`[${status}] ${description}`); doc.moveDown(0.25);
      });
    }
    doc.moveDown(0.7);
    doc.font('Helvetica').fontSize(7.5).fillColor('#555555').text(`Generated from SRA financing and closing records for export package ${pkg.exportPackageId}. Supporting underwriting evidence is retained in the transaction record and is not automatically reproduced in this recipient package.`, { align: 'center' });
    return this.finishDocument(doc, chunks, done);
  }

  async renderDealerProcessingInstructions(exportPackageId) {
    const data = this.source(exportPackageId);
    const { pkg, closing } = data;
    const { doc, chunks, done } = this.createDocument(`SRA Recipient Processing Instructions ${exportPackageId}`);
    drawPlatformLogo(doc);
    doc.font('Helvetica-Bold').fontSize(16).text(data.cashItemCollection ? 'PRESENTMENT & COLLECTION INSTRUCTIONS' : 'RECIPIENT PROCESSING INSTRUCTIONS', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text(data.cashItemCollection ? 'Cash Item Collection' : 'Transaction Settlement Processing Steps', { align: 'center' });
    doc.moveDown(0.8); rule(doc);
    line(doc, 'SRA Transaction ID', pkg.financingTransactionId || pkg.exportPackageId);
    line(doc, 'Funding Package Reference', pkg.exportPackageId);
    line(doc, 'Financing Closing Reference', closing?.closingId || pkg.closingId || null);
    line(doc, 'Beneficiary / Payee', data.recipientName);
    line(doc, 'Authorized Settlement Amount', money(pkg.amount, pkg.currency || 'USD'));
    line(doc, 'Settlement Method', data.settlementMethodLabel);

    if (data.cashItemCollection) {
      section(doc, 'To the Payee');
      doc.font('Helvetica').fontSize(9).text('The accompanying SRA Funding Settlement Note is the payment instrument for this transaction. The instrument is payable on demand and is presented as a cash item for collection through the payee\'s financial institution.', { lineGap: 1.5 });
      doc.moveDown(0.6);
      instruction(doc, 1, 'No bank routing number or deposit-account credentials are required to be provided to SRA for this settlement method.');
      instruction(doc, 2, 'Present the original executed SRA Funding Settlement Note to your financial institution for collection.');
      section(doc, 'To the Receiving Financial Institution');
      doc.font('Helvetica').fontSize(9).text('The accompanying SRA Funding Settlement Note is the payment instrument presented for collection, rather than supporting financing documentation. The instrument is payable on demand and is presented for cash-item collection under the institution\'s applicable collection procedures, including Regulation J (12 CFR Part 210, Subpart A) and Federal Reserve Operating Circular 3, as applicable.', { lineGap: 1.5 });
      doc.moveDown(0.6);
      instruction(doc, 1, 'Process the presented instrument through the institution\'s established collection procedures.');
      section(doc, 'Post-Settlement Confirmation');
      doc.font('Helvetica').fontSize(9).text(`Following collection, record the bank collection / settlement reference, settlement date, and settled amount against SRA Transaction ${pkg.financingTransactionId || pkg.exportPackageId}.`, { lineGap: 1.5 });
    } else {
      section(doc, 'Processing Procedure');
      instruction(doc, 1, 'Review the funding package and verify the transaction identifiers, purchaser / obligated party, beneficiary / payee, applicable transaction agreement, and authorized settlement amount.');
      instruction(doc, 2, 'Route the package to the recipient\'s authorized finance, accounting, treasury, receivables, or settlement-processing function.');
      instruction(doc, 3, 'Complete the destination banking information on the Settlement Execution / Recipient Completion Page within the recipient\'s controlled financial-processing environment. Sensitive banking information does not need to be returned to SRA solely for re-entry.');
      instruction(doc, 4, 'Process the authorized settlement amount using the settlement method identified in the package and the recipient\'s established financial-processing procedure.');
      instruction(doc, 5, 'Upon processing, record the bank confirmation or network reference, execution date, and actual settled amount on the Recipient Completion Page.');
      instruction(doc, 6, 'Reconcile the resulting settlement to the SRA Transaction ID and Funding Package Reference shown above.');
      instruction(doc, 7, 'If the transaction cannot be processed as presented, identify the specific processing exception or additional information required and reference the SRA Transaction ID and Funding Package Reference in the response.');
      section(doc, 'Processing Control');
      line(doc, 'Remittance / Payment Reference', pkg.exportPackageId);
      line(doc, 'Agreement / Contract No.', data.agreementNumber);
      line(doc, 'Settlement Completion Record', 'Settlement Execution / Recipient Completion Page');
      doc.moveDown(0.8);
      doc.font('Helvetica').fontSize(7.5).fillColor('#555555').text('These instructions describe recipient-side handling of the transaction package. The recipient retains its own internal accounting classifications, financial controls, and processing procedures.');
    }
    return this.finishDocument(doc, chunks, done);
  }

  async renderSettlementPage(exportPackageId) {
    const data = this.source(exportPackageId);
    const { pkg, closing, evidence } = data;
    const { doc, chunks, done } = this.createDocument(`SRA Settlement Execution ${exportPackageId}`);
    drawPlatformLogo(doc);
    doc.font('Helvetica-Bold').fontSize(16).text('SETTLEMENT EXECUTION', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Recipient Completion Page - Funding / Settlement Record', { align: 'center' });
    doc.moveDown(0.8); rule(doc);
    line(doc, 'SRA Transaction ID', pkg.financingTransactionId || pkg.exportPackageId);
    line(doc, 'Settlement Reference', pkg.exportPackageId);
    line(doc, 'Packet Date', dateLabel(new Date().toISOString()));
    line(doc, 'Settlement Method', data.settlementMethodLabel);
    section(doc, 'Transaction Information - Prepared by SRA');
    line(doc, 'Purchaser / Obligated Party', data.purchaserName);
    line(doc, 'Beneficiary / Payee', data.recipientName);
    const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ');
    if (vehicle || data.vin) { line(doc, 'Vehicle', vehicle || null); line(doc, 'VIN', data.vin); }
    line(doc, 'Agreement / Contract No.', data.agreementNumber);
    line(doc, 'Transaction Amount', money(data.purchasePrice, pkg.currency || 'USD'));
    line(doc, 'Authorized Settlement Amount', money(pkg.amount, pkg.currency || 'USD'));
    line(doc, 'Payment Purpose', data.transactionPurpose);
    line(doc, 'Remittance / Payment Reference', pkg.exportPackageId);
    section(doc, 'Operative Transaction Documentation - Prepared by SRA');
    line(doc, 'Document Reference', evidence.documentReference || null);
    line(doc, 'Document Type', evidence.documentType || null);
    line(doc, 'Document SHA-256', first(evidence.documentHash, evidence.documentSha256, data.sourceDocumentSha256));
    line(doc, 'Signature / Execution Evidence', evidence.signatureEvidenceReference || null);
    line(doc, 'Audit / Consent Evidence', first(evidence.auditTrailReference, evidence.consentEvidenceReference));
    line(doc, 'Financing Closing Reference', closing?.closingId || pkg.closingId || null);

    if (data.cashItemCollection) {
      section(doc, 'Cash Item Collection Confirmation');
      line(doc, 'Receiving Financial Institution', null);
      line(doc, 'Date Presented for Collection', null);
      line(doc, 'Bank Collection / Settlement Reference', null);
      line(doc, 'Processing Reference, if provided', null);
      line(doc, 'Settlement Date', null);
      line(doc, 'Settled Amount', null);
      line(doc, 'Return Reference / Reason, if returned', null);
    } else {
      section(doc, 'Destination Banking Information - Recipient Completes');
      line(doc, 'Business / Legal Account Name', null);
      line(doc, 'Bank Name', null);
      line(doc, 'Routing / Bank Identifier', null);
      line(doc, 'Account Number', null);
      line(doc, 'Account Type', '[  ] Checking     [  ] Savings     [  ] Other');
      section(doc, 'Settlement Confirmation');
      line(doc, 'Bank / Network Confirmation Reference', null);
      line(doc, 'Trace / Network Reference', null);
      line(doc, 'Execution Date', null);
      line(doc, 'Settled Amount', null);
    }
    section(doc, 'Package Control');
    line(doc, 'SRA Funding Package Reference', pkg.exportPackageId);
    return this.finishDocument(doc, chunks, done);
  }

  async renderServicingInstructions(exportPackageId) {
    const data = this.source(exportPackageId);
    const { pkg, closing } = data;
    const servicing = this.servicingData(data);
    const { doc, chunks, done } = this.createDocument(`SRA Servicing and Payment Instructions ${exportPackageId}`);
    drawPlatformLogo(doc);
    doc.font('Helvetica-Bold').fontSize(16).text('SERVICING & PAYMENT INSTRUCTIONS', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Post-Settlement Obligation Servicing', { align: 'center' });
    doc.moveDown(0.8); rule(doc);
    line(doc, 'SRA Transaction ID', pkg.financingTransactionId || pkg.exportPackageId);
    line(doc, 'Funding Package Reference', pkg.exportPackageId);
    line(doc, 'Financing Closing Reference', closing?.closingId || pkg.closingId || null);
    line(doc, 'Purchaser / Obligated Party', data.purchaserName);
    line(doc, 'Servicing Reference', servicing.servicingReference);
    section(doc, 'Recorded Payment Terms');
    line(doc, 'Payment Frequency', servicing.paymentFrequency);
    line(doc, 'Scheduled Payment Amount', servicing.scheduledPaymentAmount == null ? null : money(servicing.scheduledPaymentAmount, pkg.currency || 'USD'));
    line(doc, 'First Payment Date', servicing.firstPaymentDate ? dateLabel(servicing.firstPaymentDate) : null);
    line(doc, 'Maturity / Final Payment Date', servicing.maturityDate ? dateLabel(servicing.maturityDate) : null);
    line(doc, 'Servicing Payment Method', servicing.paymentMethod);
    line(doc, 'Payment Destination / Reference', servicing.paymentDestination);
    line(doc, 'Required Payment Reference', servicing.paymentReference);
    section(doc, 'Post-Settlement Procedure');
    instruction(doc, 1, 'Activate servicing only after settlement has been confirmed against the funding transaction.');
    instruction(doc, 2, 'Apply each received payment to the same financing transaction and servicing reference identified above.');
    instruction(doc, 3, 'Record the received amount, payment date, external payment / trace reference, principal application, finance / interest application when applicable, remaining principal, and outstanding balance in the servicing record.');
    instruction(doc, 4, 'Use the payment terms recorded for this transaction. Any term not present above remains unresolved in the transaction record and must not be inferred by the document generator.');
    instruction(doc, 5, 'Maintain settlement and servicing records under the same SRA Transaction ID so the funding event, settlement confirmation, repayment history, and final closure remain linked to one obligation.');
    instruction(doc, 6, 'When the obligation is fully satisfied, record the payoff / closure event against the same financing transaction and servicing reference.');
    section(doc, 'Servicing Contact / Exception Handling');
    line(doc, 'Recorded Servicing Contact', servicing.contact);
    line(doc, 'Transaction Reference for Questions', pkg.financingTransactionId || pkg.exportPackageId);
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(7.5).fillColor('#555555').text('This page is generated from recorded SRA transaction and servicing data. Blank fields indicate that the corresponding servicing term has not been recorded in the source transaction and is not supplied by assumption.');
    return this.finishDocument(doc, chunks, done);
  }

  async appendSourceDocument(output, record) {
    const bytes = await this.documents.read(record.id);
    if (!bytes) return false;
    const mime = String(record.mimeType || '').toLowerCase();
    if (mime === 'application/pdf') {
      const source = await PDFLibDocument.load(bytes, { ignoreEncryption: true });
      const pages = await output.copyPages(source, source.getPageIndices());
      pages.forEach((page) => output.addPage(page));
      return true;
    }
    if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png') {
      const image = mime === 'image/png' ? await output.embedPng(bytes) : await output.embedJpg(bytes);
      const page = output.addPage([612, 792]);
      const margin = 36;
      const scale = Math.min((612 - margin * 2) / image.width, (792 - margin * 2) / image.height, 1);
      const width = image.width * scale; const height = image.height * scale;
      page.drawImage(image, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
      return true;
    }
    return false;
  }

  async appendPdf(output, bytes) {
    const source = await PDFLibDocument.load(bytes);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }

  async validateFundingPackage(bytes, expectedMinimumPages) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 5 || bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('Generated funding package is not a valid PDF payload.');
    const validation = await PDFLibDocument.load(bytes);
    if (validation.getPageCount() < expectedMinimumPages) throw new Error('Generated funding package did not contain the expected settlement pages.');
    return true;
  }

  async renderFundingPackage(exportPackageId) {
    const data = this.source(exportPackageId);
    const packageDocuments = await this.linkedDocuments(data);
    const coverBytes = await this.renderCover(data, packageDocuments);
    const recipientInstructionsBytes = await this.renderDealerProcessingInstructions(exportPackageId);
    const settlementBytes = await this.renderSettlementPage(exportPackageId);
    const servicingBytes = await this.renderServicingInstructions(exportPackageId);
    const output = await PDFLibDocument.create();
    output.setTitle(`SRA Funding Package ${exportPackageId}`);
    output.setSubject('Transaction funding, recipient processing, settlement, and servicing package');
    await this.appendPdf(output, coverBytes);
    for (const record of packageDocuments) await this.appendSourceDocument(output, record);
    await this.appendPdf(output, recipientInstructionsBytes);
    await this.appendPdf(output, settlementBytes);
    await this.appendPdf(output, servicingBytes);
    const bytes = Buffer.from(await output.save());
    await this.validateFundingPackage(bytes, 4);
    return bytes;
  }

  async render(exportPackageId) { return this.renderFundingPackage(exportPackageId); }
}
