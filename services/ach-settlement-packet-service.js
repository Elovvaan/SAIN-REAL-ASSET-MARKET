import PDFDocument from 'pdfkit';

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

export class AchSettlementPacketService {
  constructor(domain) {
    this.domain = domain;
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
      dealershipName: first(pkg.beneficiaryName, closing?.beneficiaryName, profile.payeeName),
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

  async render(exportPackageId) {
    const data = this.source(exportPackageId);
    const { pkg, closing, evidence } = data;
    const chunks = [];
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 42, bottom: 42, left: 54, right: 54 }, info: { Title: `SRA ACH Settlement Execution Packet ${exportPackageId}` } });
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

    doc.font('Helvetica-Bold').fontSize(18).text('SRA', { align: 'center' });
    doc.fontSize(16).text('ACH SETTLEMENT EXECUTION PACKET', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Vehicle Acquisition - Dealership Completion Copy', { align: 'center' });
    doc.moveDown(0.8);
    rule(doc);

    line(doc, 'SRA Transaction ID', pkg.financingTransactionId || pkg.exportPackageId);
    line(doc, 'Settlement Reference', pkg.exportPackageId);
    line(doc, 'Packet Date', dateLabel(new Date().toISOString()));
    line(doc, 'Requested Settlement', 'ACH Credit');

    section(doc, '1. Transaction Information - Prepared by SRA');
    line(doc, 'Purchaser / Obligated Party', data.purchaserName);
    line(doc, 'Dealership / Payee', data.dealershipName);
    const vehicle = [data.vehicleYear, data.vehicleMake, data.vehicleModel].filter(Boolean).join(' ');
    line(doc, 'Vehicle', vehicle || null);
    line(doc, 'VIN', data.vin);
    line(doc, 'Purchase Agreement No.', data.agreementNumber);
    line(doc, 'Purchase Amount', money(data.purchasePrice, pkg.currency || 'USD'));
    line(doc, 'Authorized Settlement Amount', money(pkg.amount, pkg.currency || 'USD'));
    line(doc, 'Payment Purpose', 'Vehicle purchase settlement');
    line(doc, 'Remittance / Payment Reference', pkg.exportPackageId);

    section(doc, '2. Supporting Transaction Documents - Prepared by SRA');
    line(doc, 'Executed Purchase Agreement', first(data.sourceDocumentId, evidence.documentReference));
    line(doc, 'Agreement SHA-256', first(data.sourceDocumentSha256, evidence.documentSha256));
    line(doc, 'Signature / Execution Evidence', evidence.signatureEvidenceReference || null);
    line(doc, 'Audit / Consent Evidence', first(evidence.auditTrailReference, evidence.consentEvidenceReference));
    line(doc, 'Financing Closing Reference', closing?.closingId || pkg.closingId || null);

    section(doc, '3. Destination Banking Information - Dealership Completes');
    doc.font('Helvetica-Bold').fontSize(9).text('Complete the destination account information used for this settlement.');
    doc.moveDown(0.55);
    line(doc, 'Business / Legal Account Name', null);
    line(doc, 'Bank Name', null);
    line(doc, 'Routing Number', null);
    line(doc, 'Account Number', null);
    line(doc, 'Account Type', '[  ] Checking     [  ] Savings');

    section(doc, '4. Settlement Processing');
    doc.font('Helvetica').fontSize(8.5).text('Process this completed settlement through the dealership banking system using the transaction and destination information in this packet. After execution, retain or return the settlement confirmation information below for SRA reconciliation.', { lineGap: 2 });
    doc.moveDown(0.7);
    line(doc, 'ACH / Bank Confirmation Reference', null);
    line(doc, 'ACH Trace / Network Reference', null);
    line(doc, 'Execution Date', null);
    line(doc, 'Settled Amount', null);

    section(doc, '5. Packet Control');
    line(doc, 'SRA Packet Reference', pkg.exportPackageId);
    line(doc, 'Page / Attachment Count', null);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(7.5).fillColor('#555555').text(`Generated from SRA financing records for export package ${pkg.exportPackageId}.`, { align: 'center' });

    doc.end();
    await done;
    return Buffer.concat(chunks);
  }
}
