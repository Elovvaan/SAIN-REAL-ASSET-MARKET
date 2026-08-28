import crypto from 'node:crypto';

function now() { return new Date().toISOString(); }
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex'); }

const PARTICIPATION_EVENT_TYPE = 'TRANSACTION_PARTICIPATION_EVENT';
const OUTCOME_TYPE = 'OUTCOME_EVALUATION';
const MEMORY_TYPE = 'OPERATIONAL_MEMORY';

const POSITIVE_EXTERNAL_RESULTS = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'SETTLED', 'CONFIRMED', 'RECEIVED']);
const NEGATIVE_EXTERNAL_RESULTS = new Set(['FAILED', 'REJECTED', 'RETURNED', 'CANCELLED']);

export class ExternalOutcomeReconciliationService {
  constructor(domain) {
    if (!domain) throw new Error('External outcome reconciliation requires the SRA domain store.');
    this.domain = domain;
  }

  records(type) { return typeof this.domain.list === 'function' ? this.domain.list(type) : []; }

  async persist(type, id, record) {
    if (typeof this.domain.put === 'function') return await this.domain.put(type, id, record);
    if (typeof this.domain.create === 'function') return await this.domain.create(type, record);
    if (typeof this.domain.set === 'function') return await this.domain.set(type, id, record);
    throw new Error('SRA domain store does not expose a supported persistence method.');
  }

  findPackage(reference) {
    const ref = String(reference || '').trim();
    if (!ref) return null;
    return this.records('EXPORT_PACKAGE').find((pkg) =>
      pkg.exportPackageId === ref || pkg.id === ref || pkg.financingTransactionId === ref
    ) || null;
  }

  actionResultsForPackage(pkg) {
    const planId = `AP-CONTEXT-${pkg.exportPackageId}`;
    return this.records('ACTION_RESULT').filter((record) =>
      record.planId === planId || record.data?.exportPackageId === pkg.exportPackageId
    );
  }

  participationEvents(pkg) {
    return this.records(PARTICIPATION_EVENT_TYPE).filter((event) =>
      event.exportPackageId === pkg.exportPackageId ||
      (pkg.financingTransactionId && event.financingTransactionId === pkg.financingTransactionId)
    );
  }

  externalTransferResults(pkg) {
    return this.records('SRA_TRANSACTION').filter((record) =>
      record.transactionType === 'EXTERNAL_TRANSFER_RESULT' &&
      [record.exportPackageId, record.financingTransactionId, record.transactionId].some((value) =>
        value && [pkg.exportPackageId, pkg.financingTransactionId].includes(value)
      )
    );
  }

  settlementEvidence(pkg) {
    const candidates = [
      ...this.records('SRA_SETTLEMENT_RECORD'),
      ...this.records('PAYMENT_RECEIPT'),
    ];
    return candidates.filter((record) => [
      record.exportPackageId,
      record.financingTransactionId,
      record.transactionId,
      record.settlementId,
      record.externalReference,
    ].some((value) => value && [pkg.exportPackageId, pkg.financingTransactionId].includes(value)));
  }

  evidenceSnapshot(pkg) {
    const participation = this.participationEvents(pkg);
    const transferResults = this.externalTransferResults(pkg);
    const settlement = this.settlementEvidence(pkg);

    const receipt = participation.filter((event) => event.eventType === 'FUNDING_PACKAGE_RECEIPT_CONFIRMED');
    const submitted = participation.filter((event) => event.eventType === 'PACKAGE_SUBMITTED_FOR_PROCESSING');
    const exceptions = participation.filter((event) => event.eventType === 'PROCESSING_EXCEPTION_REPORTED');
    const documents = participation.filter((event) => event.eventType === 'TRANSACTION_DOCUMENT_UPLOADED');
    const questions = participation.filter((event) => event.eventType === 'PROCESSING_CLARIFICATION_REQUESTED');

    const successfulTransfer = transferResults.find((record) => POSITIVE_EXTERNAL_RESULTS.has(String(record.result || record.state || '').toUpperCase())) || null;
    const failedTransfer = transferResults.find((record) => NEGATIVE_EXTERNAL_RESULTS.has(String(record.result || record.state || '').toUpperCase())) || null;
    const confirmedSettlement = settlement.find((record) => POSITIVE_EXTERNAL_RESULTS.has(String(record.result || record.state || record.status || '').toUpperCase())) || null;
    const failedSettlement = settlement.find((record) => NEGATIVE_EXTERNAL_RESULTS.has(String(record.result || record.state || record.status || '').toUpperCase())) || null;

    return {
      receipt,
      submitted,
      exceptions,
      documents,
      questions,
      transferResults,
      settlement,
      successfulTransfer,
      failedTransfer,
      confirmedSettlement,
      failedSettlement,
    };
  }

  determineStatus(snapshot) {
    if (snapshot.failedTransfer || snapshot.failedSettlement) return 'FAILED_EXTERNAL_OUTCOME';
    if (snapshot.confirmedSettlement || snapshot.successfulTransfer) return 'VERIFIED';
    if (snapshot.exceptions.some((event) => event.details?.blocking !== false)) return 'EXCEPTION_REPORTED';
    if (snapshot.submitted.length) return 'AWAITING_EXTERNAL_CONFIRMATION';
    if (snapshot.receipt.length || snapshot.documents.length || snapshot.questions.length) return 'EXTERNAL_ACTIVITY_RECORDED';
    return 'AWAITING_EXTERNAL_ACTIVITY';
  }

  evidenceRefs(snapshot) {
    return [
      ...snapshot.receipt,
      ...snapshot.submitted,
      ...snapshot.exceptions,
      ...snapshot.documents,
      ...snapshot.questions,
    ].map((event) => ({
      type: 'TRANSACTION_PARTICIPATION_EVENT',
      id: event.eventId || event.id,
      eventType: event.eventType,
      createdAt: event.createdAt || null,
      documentId: event.documentId || null,
    })).concat(snapshot.transferResults.map((record) => ({
      type: 'EXTERNAL_TRANSFER_RESULT',
      id: record.transferResultId || record.transactionId || record.id,
      result: record.result || record.state || null,
      externalReference: record.externalReference || null,
    }))).concat(snapshot.settlement.map((record) => ({
      type: record.settlementRecordId ? 'SRA_SETTLEMENT_RECORD' : 'PAYMENT_RECEIPT',
      id: record.settlementRecordId || record.paymentReceiptId || record.id,
      status: record.status || record.state || record.result || null,
      externalReference: record.externalReference || record.reference || null,
    })));
  }

  outcomeId(pkg) { return `OX-FINANCING-${pkg.exportPackageId}`; }

  latestOutcome(pkg) {
    const id = this.outcomeId(pkg);
    return this.records(OUTCOME_TYPE).find((record) => record.outcomeId === id || record.id === id) || null;
  }

  buildOutcome(pkg) {
    const snapshot = this.evidenceSnapshot(pkg);
    const status = this.determineStatus(snapshot);
    const actionResults = this.actionResultsForPackage(pkg);
    const fundingResult = actionResults.find((record) => record.planStepId === 'FUNDING_SETTLEMENT') || null;
    const evidence = this.evidenceRefs(snapshot);
    const sourceFingerprint = fingerprint({
      exportPackage: {
        exportPackageId: pkg.exportPackageId,
        financingTransactionId: pkg.financingTransactionId || null,
        state: pkg.state || null,
        amount: pkg.amount || null,
        currency: pkg.currency || null,
        beneficiaryName: pkg.beneficiaryName || null,
      },
      evidence,
    });

    return {
      id: this.outcomeId(pkg),
      outcomeId: this.outcomeId(pkg),
      target: 'FINANCING_EXTERNAL_PROCESSING_OUTCOME',
      status,
      transactionId: pkg.financingTransactionId || pkg.exportPackageId,
      financingTransactionId: pkg.financingTransactionId || null,
      exportPackageId: pkg.exportPackageId,
      resultId: fundingResult?.resultId || null,
      expected: {
        packagePrepared: Boolean(fundingResult && ['COMPLETED', 'COMPLETED_POLICY'].includes(fundingResult.status)),
        externalProcessingConfirmationRequired: true,
        settlementVerificationRequired: true,
      },
      observed: {
        receiptConfirmed: snapshot.receipt.length > 0,
        submittedForProcessing: snapshot.submitted.length > 0,
        processingExceptionCount: snapshot.exceptions.length,
        uploadedDocumentCount: snapshot.documents.length,
        clarificationRequestCount: snapshot.questions.length,
        verifiedExternalTransfer: Boolean(snapshot.successfulTransfer),
        verifiedSettlement: Boolean(snapshot.confirmedSettlement),
        failedExternalTransfer: Boolean(snapshot.failedTransfer),
        failedSettlement: Boolean(snapshot.failedSettlement),
      },
      evidence,
      sourceFingerprint,
      notes: status === 'VERIFIED'
        ? 'External outcome verified from recorded settlement or transfer evidence.'
        : status === 'AWAITING_EXTERNAL_CONFIRMATION'
          ? 'External participant reported submission for processing; independent external confirmation is still required.'
          : status === 'EXCEPTION_REPORTED'
            ? 'A blocking external processing exception has been reported.'
            : null,
      evaluatedByAgentId: 'SRA-OUTCOME-AGENT',
      evaluatedAt: now(),
      updatedAt: now(),
    };
  }

  async rememberOutcome(outcome) {
    const memoryId = `OM-OUTCOME-${outcome.exportPackageId}`;
    const existing = this.records(MEMORY_TYPE).find((record) => record.memoryId === memoryId || record.id === memoryId) || null;
    const record = {
      id: memoryId,
      memoryId,
      subjectType: 'FINANCING_TRANSACTION',
      subjectId: outcome.financingTransactionId || outcome.exportPackageId,
      memoryType: 'EXTERNAL_OUTCOME_STATE',
      summary: `External outcome state is ${outcome.status}.`,
      facts: {
        exportPackageId: outcome.exportPackageId,
        status: outcome.status,
        observed: outcome.observed,
        sourceFingerprint: outcome.sourceFingerprint,
      },
      transactionId: outcome.transactionId,
      confidence: outcome.status === 'VERIFIED' ? 1 : 0.9,
      status: 'ACTIVE',
      recordedAt: existing?.recordedAt || now(),
      updatedAt: now(),
    };
    return await this.persist(MEMORY_TYPE, memoryId, record);
  }

  async reconcile(reference) {
    const pkg = this.findPackage(reference);
    if (!pkg) throw new Error('Financing export package was not found.');
    const next = this.buildOutcome(pkg);
    const existing = this.latestOutcome(pkg);
    if (existing?.sourceFingerprint === next.sourceFingerprint && existing?.status === next.status) {
      return { outcome: existing, changed: false };
    }
    const outcome = await this.persist(OUTCOME_TYPE, next.outcomeId, next);
    await this.rememberOutcome(outcome);
    return { outcome, changed: true };
  }

  summary(reference) {
    const pkg = this.findPackage(reference);
    if (!pkg) throw new Error('Financing export package was not found.');
    const outcome = this.latestOutcome(pkg) || this.buildOutcome(pkg);
    return {
      phase: 4,
      status: outcome.status,
      outcomeId: outcome.outcomeId,
      evidenceCount: outcome.evidence?.length || 0,
      observed: outcome.observed,
      verified: outcome.status === 'VERIFIED',
      attentionRequired: ['EXCEPTION_REPORTED', 'FAILED_EXTERNAL_OUTCOME'].includes(outcome.status),
      awaitingExternalConfirmation: outcome.status === 'AWAITING_EXTERNAL_CONFIRMATION',
    };
  }
}
