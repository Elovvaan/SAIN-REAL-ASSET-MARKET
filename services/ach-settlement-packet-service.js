import PDFKitDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import { PrivateDocumentService } from './private-document-service.js';

function text(value) {
  return value == null || value === '' ? null : String(value).trim();
}

function money(value, currency = 'USD') {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function dateLabel(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function first(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return null;
}

function line(doc, label, value, options = {}) {
  const y = doc.y;
  const labelWidth = options.labelWidth || 175;
  doc.font('Helvetica-Bold').fontSize(9).text(label, 54, y, { width: labelWidth });
  doc.font('Helvetica').fontSize(9).text(value || '______________________________________________', 54 + labelWidth, y, { width: 330 });
  doc.moveDown(0.8);
}

function section(doc, title) {
  doc.moveDown(0.55);
  doc.font('Helvetica-Bold').fontSize(12).text(title);
  doc.moveDown(0.35);
}

function rule(doc) {
  const y = doc.y;
  doc.moveTo(54, y).lineTo(558, y).strokeColor('#b9b9b9').lineWidth(0.6).stroke();
  doc.moveDown(0.6);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function documentType(record) {
  return first(record?.extraction?.facts?.documentType, record?.documentType, 'TRANSACTION_DOCUMENT');
}

function documentPriority(record) {
  const value = String(documentType(record) || '').toUpperCase();
  if (/PURCHASE_AGREEMENT|BUYER_ORDER|SALES_CONTRACT|RETAIL_INSTALLMENT|LOAN_AGREEMENT|PROMISSORY_NOTE|CONTRACT/.test(value)) return 10;
  if (/CREDIT_APPLICATION|APPLICATION/.test(value)) return 20;
  if (/ODOMETER/.test(value)) return 30;
  if (/TITLE|REGISTRATION/.test(value)) return 40;
  if (/INSURANCE/.test(value)) return 50;
  if (/AUTHORIZATION|CONSENT|SIGNATURE/.test(value)) return 60;
  if (/CHECKLIST|FUNDING_REQUIREMENT/.test(value)) return 70;
  return 100;
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

    return {
      pkg,
      closing,
      opportunity,
      participant,
      evidence,
      profile,
      purchaserName: first(profile.purchaserName, participant?.displayName, participant?.metadata?.legalName, opportunity?.applicantDisplayName, participantId),
      dealershipName: first(profile.payeeName, pkg.beneficiaryName, closing?.beneficiaryName),
      vehicleYear: first(profile.vehicleYear, assetMeta.year, opportunityMeta.vehicleYear, opportunity?.vehicleYear),
      vehicleMake: first(profile.vehicleMake, assetMeta.make, opportunityMeta.vehicleMake, opportunity?.vehicleMake),
      vehicleModel: first(profile.vehicleModel, assetMeta.model, opportunityMeta.vehicleModel, opportunity?.vehicleModel, opportunity?.title),
      vin: first(profile.vin, assetMeta.vin, assetMeta.VIN, opportunityMeta.vin, opportunityMeta.VIN, opportunity?.vin, opportunity?.VIN),
      agreementNumber: first(profile.agreementNumber, evidence.agreementNumber),
      sourceDocumentId: first(profile.sourceDocumentId, evidence.documentReference),
      sourceDocumentSha256: first(profile.sourceDocumentSha256, evidence.documentSha256),
      purchasePrice: first(profile.purchasePrice, pkg.amount),
    };
  }

  linkedDocumentIds(data) {
    const opportunity = data.opportunity || {};
    const evidenceRecords = this.domain.list('FUNDING_OPPORTUNITY_EVIDENCE')
      .filter((record) => record.opportunityId === opportunity.opportunityId);
    return unique([
      ...(Array.isArray(opportunity.supportingDocumentIds) ? opportunity.supportingDocumentIds : []),
      ...evidenceRecords.map((record) => record.documentId),
      data.sourceDocumentId,
      data.evidence?.documentReference,
    ]);
  }

  async linkedDocuments(data) {
    await this.documents.initialize();
    const records = [];
    for (const id of this.linkedDocumentIds(data)) {
      const record = this.documents.get(id);
      if (!record) continue;
      records.push(record);
    }
    return records.sort((a, b) => {
      const priority = documentPriority(a) - documentPriority(b);
      if (priority !== 0) return priority;
      return String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || ''));
    });
  }

  async renderCover(data, sourceDocuments) {
    const { pkg, closing } = data;
    const chunks = [];
    const doc = new PDFKitDocument({ size: 'LETTER', margins: { top: 42, bottom: 42, left: 54, right: 54 }, info: { Title: `SRA Funding Package ${pkg.exportPackageId}` } });
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

    doc.font('Helvetica-Bold').fontSize(18).text('SRA', { align: 'center' });
    doc.fontSize(16).text('FUNDING PACKAGE', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Transaction Documents and Settlement Instructions', { align: 'center' });
    doc.moveDown(0.8);
    rule(doc);

    line(doc, 'SRA Transaction ID', pkg.financingTransactionId || pkg.exportPackageId);
    line(doc, 'Funding Package Reference', pkg.exportPackageId);
    line(doc, 'Package Date', dateLabel(new Date().toISOString()));
    line(doc, 'Settlement Method', 'ACH Credit');

    section(doc, 'Transaction Summary');
    line(doc, 'Purchaser / Obligated Party', data.purchaserName);
    line(doc, 'Dealer / Payee', data.dealershipName);
    const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ');
    if (vehicle || data.vin) {
      line(doc, 'Vehicle', vehicle || null);
      line(doc, 'VIN', data.vin);
    }
    line(doc, 'Agreement / Contract No.', data.agreementNumber);
    line(doc, 'Purchase Price', money(data.purchasePrice, pkg.currency || 'USD'));
    line(doc, 'Authorized Settlement Amount', money(pkg.amount, pkg.currency || 'USD'));
    line(doc, 'Financing Closing Reference', closing?.closingId || pkg.closingId || null);

    section(doc, 'Package Document Manifest');
    if (!sourceDocuments.length) {
      doc.font('Helvetica').fontSize(9).text('No linked source documents are currently recorded for this funding opportunity.');
    } else {
      sourceDocuments.forEach((record, index) => {
        doc.font('Helvetica-Bold').fontSize(9).text(`${index + 1}. ${text(documentType(record)) || 'Transaction Document'}`);
        doc.font('Helvetica').fontSize(8).text(`${record.originalName || record.id}  |  ${record.id}  |  SHA-256 ${record.sha256 || 'not recorded'}`, { indent: 12 });
        doc.moveDown(0.35);
      });
    }

    if (Array.isArray(closing?.conditions) && closing.conditions.length) {
      section(doc, 'Recorded Closing Requirements');
      closing.conditions
        .filter((condition) => String(condition.status || '').toUpperCase() !== 'CANCELLED')
        .forEach((condition) => {
          const status = String(condition.status || 'OPEN').toUpperCase();
          const description = first(condition.description, condition.requirement, condition.title, 'Closing requirement');
          doc.font('Helvetica').fontSize(8.5).text(`[${status}] ${description}`);
          doc.moveDown(0.25);
        });
    }

    doc.moveDown(0.7);
    doc.font('Helvetica').fontSize(7.5).fillColor('#555555').text(`Generated from SRA financing and transaction-document records for export package ${pkg.exportPackageId}.`, { align: 'center' });
    doc.end();
    await done;
    return Buffer.concat(chunks);
  }

  async renderSettlementPage(exportPackageId) {
    const data = this.source(exportPackageId);
    const { pkg, closing, evidence } = data;
    const chunks = [];
    const doc = new PDFKitDocument({ size: 'LETTER', margins: { top: 42, bottom: 42, left: 54, right: 54 }, info: { Title: `SRA ACH Settlement Execution ${exportPackageId}` } });
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

    doc.font('Helvetica-Bold').fontSize(18).text('SRA', { align: 'center' });
    doc.fontSize(16).text('ACH SETTLEMENT EXECUTION', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Dealership Completion Page', { align: 'center' });
    doc.moveDown(0.8);
    rule(doc);

    line(doc, 'SRA Transaction ID', pkg.financingTransactionId || pkg.exportPackageId);
    line(doc, 'Settlement Reference', pkg.exportPackageId);
    line(doc, 'Packet Date', dateLabel(new Date().toISOString()));
    line(doc, 'Requested Settlement', 'ACH Credit');

    section(doc, 'Transaction Information - Prepared by SRA');
    line(doc, 'Purchaser / Obligated Party', data.purchaserName);
    line(doc, 'Dealership / Payee', data.dealershipName);
    const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ');
    line(doc, 'Vehicle', vehicle || null);
    line(doc, 'VIN', data.vin);
    line(doc, 'Agreement / Contract No.', data.agreementNumber);
    line(doc, 'Purchase Amount', money(data.purchasePrice, pkg.currency || 'USD'));
    line(doc, 'Authorized Settlement Amount', money(pkg.amount, pkg.currency || 'USD'));
    line(doc, 'Payment Purpose', 'Vehicle purchase settlement');
    line(doc, 'Remittance / Payment Reference', pkg.exportPackageId);

    section(doc, 'Supporting Transaction Documents - Prepared by SRA');
    line(doc, 'Executed Purchase Agreement', first(data.sourceDocumentId, evidence.documentReference));
    line(doc, 'Agreement SHA-256', first(data.sourceDocumentSha256, evidence.documentSha256));
    line(doc, 'Signature / Execution Evidence', evidence.signatureEvidenceReference || null);
    line(doc, 'Audit / Consent Evidence', first(evidence.auditTrailReference, evidence.consentEvidenceReference));
    line(doc, 'Financing Closing Reference', closing?.closingId || pkg.closingId || null);

    section(doc, 'Destination Banking Information - Dealership Completes');
    line(doc, 'Business / Legal Account Name', null);
    line(doc, 'Bank Name', null);
    line(doc, 'Routing Number', null);
    line(doc, 'Account Number', null);
    line(doc, 'Account Type', '[  ] Checking     [  ] Savings');

    section(doc, 'Settlement Confirmation');
    line(doc, 'ACH / Bank Confirmation Reference', null);
    line(doc, 'ACH Trace / Network Reference', null);
    line(doc, 'Execution Date', null);
    line(doc, 'Settled Amount', null);

    section(doc, 'Package Control');
    line(doc, 'SRA Funding Package Reference', pkg.exportPackageId);
    doc.end();
    await done;
    return Buffer.concat(chunks);
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
      const availableWidth = 612 - margin * 2;
      const availableHeight = 792 - margin * 2;
      const scale = Math.min(availableWidth / image.width, availableHeight / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
      return true;
    }
    return false;
  }

  async renderFundingPackage(exportPackageId) {
    const data = this.source(exportPackageId);
    const sourceDocuments = await this.linkedDocuments(data);
    const coverBytes = await this.renderCover(data, sourceDocuments);
    const settlementBytes = await this.renderSettlementPage(exportPackageId);

    const output = await PDFLibDocument.create();
    output.setTitle(`SRA Funding Package ${exportPackageId}`);
    output.setSubject('Transaction funding documents and ACH settlement instructions');

    const cover = await PDFLibDocument.load(coverBytes);
    const coverPages = await output.copyPages(cover, cover.getPageIndices());
    coverPages.forEach((page) => output.addPage(page));

    for (const record of sourceDocuments) {
      await this.appendSourceDocument(output, record);
    }

    const settlement = await PDFLibDocument.load(settlementBytes);
    const settlementPages = await output.copyPages(settlement, settlement.getPageIndices());
    settlementPages.forEach((page) => output.addPage(page));

    const bytes = await output.save();
    return Buffer.from(bytes);
  }

  async render(exportPackageId) {
    return this.renderSettlementPage(exportPackageId);
  }
}
