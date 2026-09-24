import crypto from 'node:crypto';

const LEDGER_TYPE = 'FUNDING_SETTLEMENT_INSTRUMENT_LEDGER';
const CLOSING_TYPE = 'FINANCING_CLOSING';
const DISBURSEMENT_TYPE = 'FINANCING_DISBURSEMENT';
const EXPORT_PACKAGE_TYPE = 'EXPORT_PACKAGE';

function now() { return new Date().toISOString(); }
function id() { return `FSIL-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function text(value) { return value == null ? null : String(value).trim() || null; }
function amount(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : null; }
function first(...values) { for (const value of values) if (value !== null && value !== undefined && String(value).trim() !== '') return value; return null; }

export class FundingSettlementInstrumentLedgerService {
  constructor(domain) {
    if (!domain) throw new Error('Funding/Settlement Instrument Ledger requires the SRA domain store.');
    this.domain = domain;
  }

  list(filters = {}) {
    return this.domain.list(LEDGER_TYPE).filter((record) =>
      (!filters.opportunityId || record.opportunityId === filters.opportunityId) &&
      (!filters.financingTransactionId || record.financingTransactionId === filters.financingTransactionId) &&
      (!filters.exportPackageId || record.exportPackageId === filters.exportPackageId) &&
      (!filters.status || record.status === filters.status)
    );
  }

  get(ledgerId) { return this.domain.get(LEDGER_TYPE, ledgerId); }

  forExportPackage(exportPackageId) {
    return this.list({ exportPackageId })[0] || null;
  }

  source(exportPackageId) {
    const pkg = this.domain.get(EXPORT_PACKAGE_TYPE, exportPackageId);
    if (!pkg) throw new Error('Financing export package was not found.');
    const closing = pkg.closingId ? this.domain.get(CLOSING_TYPE, pkg.closingId) : null;
    const disbursement = pkg.disbursementId ? this.domain.get(DISBURSEMENT_TYPE, pkg.disbursementId) : null;
    const opportunity = pkg.opportunityId ? this.domain.get('FUNDING_OPPORTUNITY', pkg.opportunityId) : null;
    return { pkg, closing, disbursement, opportunity };
  }

  async originate(exportPackageId, input = {}, actorId = null) {
    const existing = this.forExportPackage(exportPackageId);
    if (existing) return existing;
    const { pkg, closing, disbursement, opportunity } = this.source(exportPackageId);
    const timestamp = now();
    const ledgerId = id();
    const authorizationReference = first(
      input.authorizationReference,
      closing?.financingTransactionId,
      pkg.financingTransactionId,
    );
    const record = {
      ledgerId,
      ledgerType: 'FUNDING_SETTLEMENT_INSTRUMENT',
      opportunityId: pkg.opportunityId || null,
      closingId: pkg.closingId || null,
      disbursementId: pkg.disbursementId || null,
      exportPackageId: pkg.exportPackageId,
      financingTransactionId: pkg.financingTransactionId || null,
      instrumentId: pkg.instrumentId || closing?.instrumentId || null,
      payeeName: pkg.beneficiaryName || closing?.beneficiaryName || null,
      authorizedAmount: amount(pkg.amount),
      currency: pkg.currency || 'USD',
      disbursementStage: disbursement?.disbursementStage || pkg.disbursementStage || null,
      disbursementPurpose: disbursement?.disbursementPurpose || pkg.disbursementPurpose || null,
      escrowAdministration: (disbursement?.disbursementStage === 'PRE_CLOSING' || pkg.disbursementStage === 'PRE_CLOSING') ? {
        escrowAgent: first(disbursement?.settlementInstructions?.escrowAgent, pkg.settlementInstructions?.escrowAgent),
        escrowReference: first(disbursement?.settlementInstructions?.escrowReference, pkg.settlementInstructions?.escrowReference),
        contractReference: first(disbursement?.settlementInstructions?.contractReference, pkg.settlementInstructions?.contractReference),
      } : null,
      status: 'ORIGINATION_RECORDED',
      originationAuthority: {
        authorizationReference,
        authorizedBy: first(input.authorizedBy, disbursement?.authorizedBy, pkg.authorizedBy, actorId),
        authorizedAt: first(input.authorizedAt, disbursement?.authorizedAt, pkg.authorizedAt, closing?.authorizedAt),
        authorityReason: first(input.authorityReason, opportunity?.purpose, opportunity?.description, 'Authorized funding opportunity and closing'),
        opportunityDecision: opportunity?.creditDecision || null,
        closingReference: pkg.closingId || null,
      },
      executionEvidence: null,
      escrowReceipt: null,
      presentmentRecord: null,
      processingOutcome: null,
      reconciliation: null,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.domain.put(LEDGER_TYPE, ledgerId, record, { actorId, eventType: 'FUNDING_SETTLEMENT_LEDGER_ORIGINATED' });
    return record;
  }

  async recordExecution(ledgerId, input = {}, actorId = null) {
    const current = this.get(ledgerId); if (!current) throw new Error('Funding/Settlement Instrument Ledger record was not found.');
    const timestamp = now();
    const evidence = {
      noteDocumentId: text(input.noteDocumentId),
      noteSha256: text(input.noteSha256),
      instrumentId: first(input.instrumentId, current.instrumentId),
      executedBy: text(input.executedBy),
      executedAt: text(input.executedAt) || timestamp,
      executionReference: text(input.executionReference),
      properlyFormed: input.properlyFormed === true,
      recordedBy: actorId,
      recordedAt: timestamp,
    };
    if (!evidence.noteDocumentId && !evidence.executionReference) throw new Error('Execution evidence requires a note document or execution reference.');
    const updated = { ...current, executionEvidence: evidence, status: 'EXECUTION_RECORDED', updatedAt: timestamp };
    await this.domain.put(LEDGER_TYPE, ledgerId, updated, { actorId, eventType: 'FUNDING_SETTLEMENT_NOTE_EXECUTION_RECORDED' });
    return updated;
  }

  async recordEscrowReceipt(ledgerId, input = {}, actorId = null) {
    const current = this.get(ledgerId); if (!current) throw new Error('Funding/Settlement Instrument Ledger record was not found.');
    if (!current.executionEvidence) throw new Error('Execution evidence must be recorded before escrow receipt.');
    const timestamp = now();
    const escrowAgent = first(input.escrowAgent, current.escrowAdministration?.escrowAgent);
    const receivedAt = text(input.receivedAt);
    const receiptReference = text(input.receiptReference);
    if (!escrowAgent || !receivedAt || !receiptReference) throw new Error('Escrow receipt requires escrowAgent, receivedAt, and receiptReference.');
    const receipt = {
      escrowAgent,
      escrowReference: first(input.escrowReference, current.escrowAdministration?.escrowReference),
      contractReference: first(input.contractReference, current.escrowAdministration?.contractReference),
      receivedAt,
      receiptReference,
      evidenceReference: text(input.evidenceReference),
      receivedBy: text(input.receivedBy),
      recordedBy: actorId,
      recordedAt: timestamp,
    };
    const updated = { ...current, escrowReceipt: receipt, status: 'ESCROW_RECEIPT_RECORDED', updatedAt: timestamp };
    await this.domain.put(LEDGER_TYPE, ledgerId, updated, { actorId, eventType: 'FUNDING_SETTLEMENT_ESCROW_RECEIPT_RECORDED' });
    return updated;
  }

  async recordPresentment(ledgerId, input = {}, actorId = null) {
    const current = this.get(ledgerId); if (!current) throw new Error('Funding/Settlement Instrument Ledger record was not found.');
    if (!current.executionEvidence) throw new Error('Execution evidence must be recorded before presentment.');
    if (current.disbursementStage === 'PRE_CLOSING' && current.disbursementPurpose === 'EARNEST_MONEY' && !current.escrowReceipt) throw new Error('Escrow receipt must be recorded before earnest-money presentment.');
    const institutionName = text(input.institutionName);
    const presentedAt = text(input.presentedAt);
    if (!institutionName || !presentedAt) throw new Error('Presentment requires institutionName and presentedAt.');
    const timestamp = now();
    const record = {
      institutionName,
      receivingDepartment: text(input.receivingDepartment),
      processingContact: text(input.processingContact),
      presentedAt,
      presentmentReference: text(input.presentmentReference),
      presentedBy: text(input.presentedBy),
      evidenceReference: text(input.evidenceReference),
      recordedBy: actorId,
      recordedAt: timestamp,
    };
    const updated = { ...current, presentmentRecord: record, status: 'PRESENTED', updatedAt: timestamp };
    await this.domain.put(LEDGER_TYPE, ledgerId, updated, { actorId, eventType: 'FUNDING_SETTLEMENT_NOTE_PRESENTED' });
    return updated;
  }

  async recordProcessingOutcome(ledgerId, input = {}, actorId = null) {
    const current = this.get(ledgerId); if (!current) throw new Error('Funding/Settlement Instrument Ledger record was not found.');
    if (!current.presentmentRecord) throw new Error('Presentment must be recorded before a processing outcome.');
    const outcome = String(input.outcome || '').trim().toUpperCase();
    if (!['SETTLED','RETURNED','EXCEPTION','PROCESSING'].includes(outcome)) throw new Error('Processing outcome must be SETTLED, RETURNED, EXCEPTION, or PROCESSING.');
    const timestamp = now();
    const record = {
      outcome,
      institutionReference: text(input.institutionReference),
      collectionReference: text(input.collectionReference),
      settlementOrProcessingMechanism: text(input.settlementOrProcessingMechanism),
      achTraceOrPaymentReference: text(input.achTraceOrPaymentReference),
      federalReserveReference: text(input.federalReserveReference),
      settlementReference: text(input.settlementReference),
      evidenceReference: text(input.evidenceReference),
      evidenceSha256: text(input.evidenceSha256),
      processedAt: text(input.processedAt) || timestamp,
      settledAt: text(input.settledAt),
      settledAmount: amount(input.settledAmount),
      returnOrExceptionInformation: text(input.returnOrExceptionInformation),
      recordedBy: actorId,
      recordedAt: timestamp,
    };
    if (!record.institutionReference && !record.collectionReference && !record.federalReserveReference && !record.settlementReference && !record.evidenceReference) {
      throw new Error('Processing outcome requires institutional or processing evidence.');
    }
    const updated = { ...current, processingOutcome: record, status: outcome === 'SETTLED' ? 'PROCESSING_CONFIRMED' : outcome, updatedAt: timestamp };
    await this.domain.put(LEDGER_TYPE, ledgerId, updated, { actorId, eventType: `FUNDING_SETTLEMENT_PROCESSING_${outcome}` });
    return updated;
  }

  async reconcile(ledgerId, input = {}, actorId = null) {
    const current = this.get(ledgerId); if (!current) throw new Error('Funding/Settlement Instrument Ledger record was not found.');
    if (!current.processingOutcome) throw new Error('Processing outcome must be recorded before SRA reconciliation.');
    const matched = input.matched === true;
    const timestamp = now();
    const reconciliation = {
      matched,
      transactionIdMatches: input.transactionIdMatches !== false,
      instrumentMatches: input.instrumentMatches !== false,
      payeeMatches: input.payeeMatches !== false,
      amountMatches: input.amountMatches !== false,
      institutionalRecordReference: first(input.institutionalRecordReference, current.processingOutcome.settlementReference, current.processingOutcome.institutionReference, current.processingOutcome.collectionReference),
      reconciliationEvidenceReference: text(input.reconciliationEvidenceReference),
      notes: text(input.notes),
      reconciledBy: actorId,
      reconciledAt: timestamp,
    };
    const status = matched && current.processingOutcome.outcome === 'SETTLED' ? 'RECONCILED' : 'RECONCILIATION_EXCEPTION';
    const updated = { ...current, reconciliation, status, updatedAt: timestamp };
    await this.domain.put(LEDGER_TYPE, ledgerId, updated, { actorId, eventType: status === 'RECONCILED' ? 'FUNDING_SETTLEMENT_RECONCILED' : 'FUNDING_SETTLEMENT_RECONCILIATION_EXCEPTION' });
    return updated;
  }
}

export { LEDGER_TYPE as FUNDING_SETTLEMENT_INSTRUMENT_LEDGER_TYPE };
