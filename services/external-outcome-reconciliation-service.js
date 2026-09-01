import crypto from 'node:crypto';

function now() { return new Date().toISOString(); }
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex'); }
function first(...values) { for (const value of values) if (value !== null && value !== undefined && String(value).trim() !== '') return value; return null; }
function amount(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : null; }
function text(value) { return value === null || value === undefined ? null : String(value).trim() || null; }

const PARTICIPATION_EVENT_TYPE = 'TRANSACTION_PARTICIPATION_EVENT';
const EXTERNAL_INTERACTION_EVENT_TYPE = 'EXTERNAL_INTERACTION_EVENT';
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

  externalInteractions(pkg) {
    return this.records(EXTERNAL_INTERACTION_EVENT_TYPE).filter((event) =>
      event.exportPackageId === pkg.exportPackageId ||
      event.transactionId === pkg.financingTransactionId ||
      event.financingTransactionId === pkg.financingTransactionId ||
      event.objectId === pkg.exportPackageId ||
      (pkg.instrumentId && event.objectId === pkg.instrumentId)
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
    const externalInteractions = this.externalInteractions(pkg);
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
      externalInteractions,
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
    if (snapshot.receipt.length || snapshot.documents.length || snapshot.questions.length || snapshot.externalInteractions.length) return 'EXTERNAL_ACTIVITY_RECORDED';
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
    })).concat(snapshot.externalInteractions.map((event) => ({
      type: EXTERNAL_INTERACTION_EVENT_TYPE,
      id: event.eventId || event.id,
      interactionType: event.interactionType || event.eventType || null,
      channel: event.channel || null,
      actorType: event.actorType || null,
      outcome: event.outcome || event.status || null,
      createdAt: event.createdAt || event.occurredAt || null,
    }))).concat(snapshot.transferResults.map((record) => ({
      type: 'EXTERNAL_TRANSFER_RESULT',
      id: record.transferResultId || record.transactionId || record.id,
      result: record.result || record.state || null,
      externalReference: record.externalReference || null,
      amount: amount(first(record.amount, record.settledAmount, record.receivedAmount)),
      occurredAt: first(record.settledAt, record.completedAt, record.updatedAt, record.createdAt),
    }))).concat(snapshot.settlement.map((record) => ({
      type: record.settlementRecordId ? 'SRA_SETTLEMENT_RECORD' : 'PAYMENT_RECEIPT',
      id: record.settlementRecordId || record.paymentReceiptId || record.id,
      status: record.status || record.state || record.result || null,
      externalReference: record.externalReference || record.reference || null,
      amount: amount(first(record.amount, record.settledAmount, record.receivedAmount)),
      occurredAt: first(record.settledAt, record.receivedAt, record.completedAt, record.updatedAt, record.createdAt),
    })));
  }

  settlementConclusion(pkg, snapshot, status) {
    const source = snapshot.confirmedSettlement || snapshot.successfulTransfer || snapshot.failedSettlement || snapshot.failedTransfer || null;
    const expectedAmount = amount(pkg.amount);
    const settledAmount = source ? amount(first(source.settledAmount, source.amount, source.receivedAmount, source.valueAmount)) : null;
    const settlementReference = source ? text(first(source.collectionReference, source.settlementReference, source.externalReference, source.reference, source.traceNumber, source.transactionHash)) : null;
    const settlementDate = source ? text(first(source.settledAt, source.receivedAt, source.completedAt, source.processedAt, source.updatedAt, source.createdAt)) : null;
    const observedBeneficiary = source ? text(first(source.beneficiaryName, source.payeeName, source.recipientName, source.accountName)) : null;
    const expectedBeneficiary = text(pkg.beneficiaryName);
    const amountMatches = expectedAmount !== null && settledAmount !== null ? expectedAmount === settledAmount : null;
    const beneficiaryMatches = expectedBeneficiary && observedBeneficiary
      ? expectedBeneficiary.toUpperCase() === observedBeneficiary.toUpperCase()
      : null;
    const mismatch = amountMatches === false || beneficiaryMatches === false;
    const failed = status === 'FAILED_EXTERNAL_OUTCOME';
    const verified = status === 'VERIFIED';
    const conclusionStatus = failed || mismatch
      ? 'EXCEPTION'
      : verified
        ? 'SETTLEMENT_COMPLETE'
        : 'PENDING_EXTERNAL_CONFIRMATION';
    const nextLifecycleAction = conclusionStatus === 'SETTLEMENT_COMPLETE'
      ? 'PREPARE_SERVICING_HANDOFF'
      : conclusionStatus === 'EXCEPTION'
        ? 'REVIEW_SETTLEMENT_EXCEPTION'
        : 'AWAIT_EXTERNAL_CONFIRMATION';

    let narrative;
    if (conclusionStatus === 'SETTLEMENT_COMPLETE') {
      const amountText = settledAmount !== null ? `$${settledAmount.toFixed(2)}` : expectedAmount !== null ? `$${expectedAmount.toFixed(2)}` : 'the authorized amount';
      narrative = `Recorded external evidence verifies settlement of ${amountText}${expectedBeneficiary ? ` to ${expectedBeneficiary}` : ''}${settlementReference ? ` under reference ${settlementReference}` : ''}. The financing settlement outcome is reconciled and ready for the servicing handoff.`;
    } else if (conclusionStatus === 'EXCEPTION') {
      const issues = [];
      if (failed) issues.push('the external result is failed or returned');
      if (amountMatches === false) issues.push(`expected $${expectedAmount.toFixed(2)} but recorded $${settledAmount.toFixed(2)}`);
      if (beneficiaryMatches === false) issues.push(`expected beneficiary ${expectedBeneficiary} but recorded ${observedBeneficiary}`);
      narrative = `Settlement conclusion requires review because ${issues.join('; ')}. Do not treat the financing settlement as complete until the exception is resolved.`;
    } else {
      narrative = 'External activity is recorded, but independent settlement confirmation is not yet sufficient to conclude that the financing settlement is complete.';
    }

    return {
      conclusionStatus,
      expectedAmount,
      settledAmount,
      currency: pkg.currency || 'USD',
      expectedBeneficiary,
      observedBeneficiary,
      amountMatches,
      beneficiaryMatches,
      settlementReference,
      settlementDate,
      sourceEvidenceType: source ? (source.settlementRecordId ? 'SRA_SETTLEMENT_RECORD' : source.paymentReceiptId ? 'PAYMENT_RECEIPT' : 'EXTERNAL_TRANSFER_RESULT') : null,
      sourceEvidenceId: source ? first(source.settlementRecordId, source.paymentReceiptId, source.transferResultId, source.transactionId, source.id) : null,
      nextLifecycleAction,
      narrative,
      preparedByAgentId: 'SRA-OUTCOME-AGENT',
      preparedAt: now(),
    };
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
    const settlementConclusion = this.settlementConclusion(pkg, snapshot, status);
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
      settlementConclusion: {
        conclusionStatus: settlementConclusion.conclusionStatus,
        settledAmount: settlementConclusion.settledAmount,
        settlementReference: settlementConclusion.settlementReference,
        settlementDate: settlementConclusion.settlementDate,
        observedBeneficiary: settlementConclusion.observedBeneficiary,
      },
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
        externalInteractionCount: snapshot.externalInteractions.length,
        verifiedExternalTransfer: Boolean(snapshot.successfulTransfer),
        verifiedSettlement: Boolean(snapshot.confirmedSettlement),
        failedExternalTransfer: Boolean(snapshot.failedTransfer),
        failedSettlement: Boolean(snapshot.failedSettlement),
      },
      evidence,
      settlementConclusion,
      sourceFingerprint,
      notes: settlementConclusion.narrative,
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
      summary: outcome.settlementConclusion?.narrative || `External outcome state is ${outcome.status}.`,
      facts: {
        exportPackageId: outcome.exportPackageId,
        status: outcome.status,
        observed: outcome.observed,
        settlementConclusion: outcome.settlementConclusion || null,
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
      settlementConclusion: outcome.settlementConclusion || null,
      verified: outcome.status === 'VERIFIED' && outcome.settlementConclusion?.conclusionStatus === 'SETTLEMENT_COMPLETE',
      attentionRequired: ['EXCEPTION_REPORTED', 'FAILED_EXTERNAL_OUTCOME'].includes(outcome.status) || outcome.settlementConclusion?.conclusionStatus === 'EXCEPTION',
      awaitingExternalConfirmation: outcome.settlementConclusion?.conclusionStatus === 'PENDING_EXTERNAL_CONFIRMATION',
    };
  }
}
