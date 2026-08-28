import crypto from 'node:crypto';
import { ContextInstructionReasoningService } from './context-instruction-reasoning-service.js';
import { ExternalOutcomeReconciliationService } from './external-outcome-reconciliation-service.js';

const CASE_TYPE = 'COUNTERPARTY_OPERATION_CASE';
const RESPONSE_TYPE = 'COUNTERPARTY_OPERATION_RESPONSE';

function now() { return new Date().toISOString(); }
function upper(value) { return String(value || '').trim().toUpperCase(); }
function clean(value, max = 5000) { const text = String(value || '').trim(); return text ? text.slice(0, max) : null; }
function stableId(prefix, ...parts) {
  const digest = crypto.createHash('sha256').update(parts.map((part) => String(part || '')).join('|')).digest('hex').slice(0, 20).toUpperCase();
  return `${prefix}-${digest}`;
}

const RESERVED_TOPICS = new Set([
  'FINANCING_APPROVAL', 'FINANCING_TERMS_CHANGE', 'AMOUNT_CHANGE', 'SETTLEMENT_AUTHORIZATION',
  'SETTLEMENT_EXECUTION', 'EXTERNAL_TRANSFER_AUTHORIZATION', 'EXTERNAL_TRANSFER_EXECUTION',
  'INSTRUMENT_ISSUANCE', 'OWNERSHIP_TRANSFER', 'PAYMENT_AUTHORIZATION',
]);

export class CounterpartyOperationsService {
  constructor(domain, options = {}) {
    if (!domain) throw new Error('Counterparty operations requires the SRA domain store.');
    this.domain = domain;
    this.reasoning = options.reasoning || new ContextInstructionReasoningService(domain);
    this.outcomes = options.outcomes || new ExternalOutcomeReconciliationService(domain);
    this.gateway = options.gateway || null;
    this.hydrated = false;
    this.hydrationPromise = null;
  }

  records(type) { return typeof this.domain.list === 'function' ? this.domain.list(type) : []; }
  async persist(type, id, payload) {
    if (typeof this.domain.put === 'function') return await this.domain.put(type, id, payload);
    if (typeof this.domain.create === 'function') return await this.domain.create(type, payload);
    if (typeof this.domain.set === 'function') return await this.domain.set(type, id, payload);
    throw new Error('SRA domain store does not expose a supported persistence method.');
  }

  async ensureHydrated() {
    if (this.hydrated) return;
    if (typeof this.domain.hydrate !== 'function') { this.hydrated = true; return; }
    if (!this.hydrationPromise) {
      this.hydrationPromise = Promise.resolve(this.domain.hydrate([
        CASE_TYPE, RESPONSE_TYPE, 'TRANSACTION_PARTICIPATION_EVENT', 'OPERATIONAL_EVENT',
        'OPERATIONAL_MEMORY', 'OUTCOME_EVALUATION', 'EXPORT_PACKAGE', 'FINANCING_CLOSING', 'FUNDING_OPPORTUNITY',
      ])).then(() => { this.hydrated = true; }).finally(() => { this.hydrationPromise = null; });
    }
    await this.hydrationPromise;
  }

  package(exportPackageId) {
    return this.records('EXPORT_PACKAGE').find((record) => record.exportPackageId === exportPackageId || record.id === exportPackageId) || null;
  }

  participationEvents(exportPackageId) {
    return this.records('TRANSACTION_PARTICIPATION_EVENT')
      .filter((event) => event.exportPackageId === exportPackageId)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }

  transactionSnapshot(exportPackageId) {
    const pkg = this.package(exportPackageId);
    if (!pkg) throw new Error('Funding package was not found.');
    const closing = pkg.closingId ? this.records('FINANCING_CLOSING').find((record) => record.closingId === pkg.closingId || record.id === pkg.closingId) : null;
    const opportunity = pkg.opportunityId ? this.records('FUNDING_OPPORTUNITY').find((record) => record.opportunityId === pkg.opportunityId || record.id === pkg.opportunityId) : null;
    return {
      exportPackageId: pkg.exportPackageId,
      financingTransactionId: pkg.financingTransactionId || null,
      state: pkg.state || null,
      beneficiaryName: pkg.beneficiaryName || null,
      amount: Number(pkg.amount || pkg.authorizedSettlementAmount || 0) || null,
      currency: pkg.currency || null,
      settlementMethod: pkg.settlementMethod || pkg.paymentMethod || null,
      opportunityId: pkg.opportunityId || null,
      closingId: pkg.closingId || null,
      fundingPackageReference: pkg.fundingPackageReference || pkg.packageReference || null,
      closingReference: closing?.closingReference || closing?.id || null,
      financingStage: opportunity?.financingStage || null,
    };
  }

  classify(event = {}) {
    const topic = upper(event.details?.topic || event.topic || 'GENERAL_PROCESSING');
    const text = `${event.summary || ''} ${event.details?.question || ''} ${event.details?.issue || ''}`.toUpperCase();
    const requestedChange = /CHANGE|INCREASE|DECREASE|REVISE|MODIFY|DIFFERENT AMOUNT|MORE FUND|LESS FUND/.test(text);
    const authorityRequired = RESERVED_TOPICS.has(topic) || requestedChange;
    if (authorityRequired) return { topic, class: 'RESERVED_AUTHORITY', authorityRequired: true };
    if (/ACH|ROUTING|ACCOUNT|BANK/.test(`${topic} ${text}`)) return { topic: 'ACH_PROCESSING', class: 'TRANSACTION_CLARIFICATION', authorityRequired: false };
    if (/INSTRUMENT|NOTE|DRAFT|OBLIGATION/.test(`${topic} ${text}`)) return { topic: 'INSTRUMENT_PROCESSING', class: 'TRANSACTION_CLARIFICATION', authorityRequired: false };
    if (event.eventType === 'PROCESSING_EXCEPTION_REPORTED') return { topic, class: 'PROCESSING_EXCEPTION', authorityRequired: false };
    return { topic, class: 'TRANSACTION_CLARIFICATION', authorityRequired: false };
  }

  buildGroundedResponse(snapshot, reasoning, outcome, classification, event) {
    const unresolved = [...(reasoning.unresolvedFields || []), ...(reasoning.unresolvedServicingFields || [])];
    if (classification.authorityRequired) {
      return {
        status: 'AWAITING_PRINCIPAL_AUTHORITY',
        response: 'Your request has been recorded against this transaction and routed for the required authorization. The existing recorded transaction terms remain in effect until an authorized change is recorded.',
        nextAction: 'PRINCIPAL_REVIEW_REQUIRED',
        authorityRequired: true,
      };
    }
    if (unresolved.length) {
      return {
        status: 'BLOCKED_RECORDED_CONTEXT_REQUIRED',
        response: `The transaction is identified, but SRA requires recorded transaction data before giving processing instructions for: ${unresolved.join(', ')}. The request has been retained with the transaction for resolution.`,
        nextAction: 'RESOLVE_RECORDED_CONTEXT',
        authorityRequired: false,
      };
    }
    if (classification.class === 'PROCESSING_EXCEPTION') {
      return {
        status: 'EXCEPTION_UNDER_REVIEW',
        response: `The processing exception has been recorded for funding package ${snapshot.exportPackageId}. SRA will use the transaction record and submitted evidence to determine the corrective step. No settlement or financing term is changed by this report.`,
        nextAction: 'REASON_EXCEPTION_AND_CONTINUE',
        authorityRequired: false,
      };
    }
    const stateText = outcome.status === 'VERIFIED'
      ? 'The external outcome is recorded as verified.'
      : outcome.status === 'FAILED_EXTERNAL_OUTCOME'
        ? 'A failed external outcome is recorded and requires resolution before continuation.'
        : 'External completion has not yet been independently verified.';
    const method = snapshot.settlementMethod ? ` The recorded settlement method is ${snapshot.settlementMethod}.` : '';
    return {
      status: 'ANSWERED_FROM_TRANSACTION_RECORD',
      response: `This request is tied to funding package ${snapshot.exportPackageId}${snapshot.financingTransactionId ? ` and financing transaction ${snapshot.financingTransactionId}` : ''}.${method} ${stateText} Please process only from the current funding package and its recorded instructions; if your system requires a different amount, destination, instrument term, or authorization, submit that as a transaction change request for review.`,
      nextAction: outcome.status === 'VERIFIED' ? 'NO_FURTHER_PROCESSING_REQUIRED' : 'CONTINUE_CURRENT_RECORDED_PROCESS',
      authorityRequired: false,
    };
  }

  async resolveParticipationEvent(eventId, options = {}) {
    await this.ensureHydrated();
    const event = this.records('TRANSACTION_PARTICIPATION_EVENT').find((record) => record.eventId === eventId || record.id === eventId);
    if (!event) throw new Error('Counterparty participation event was not found.');
    if (!event.exportPackageId) throw new Error('Counterparty event is not linked to a funding package.');
    const responseId = stableId('CPR', event.exportPackageId, event.eventId);
    const existing = this.records(RESPONSE_TYPE).find((record) => record.responseId === responseId || record.id === responseId);
    if (existing) return existing;

    const snapshot = this.transactionSnapshot(event.exportPackageId);
    const reasoning = this.reasoning.reasonForExportPackage(event.exportPackageId);
    const outcome = await this.outcomes.reconcile(event.exportPackageId, { persist: false, agentId: options.agentId || 'SRA-COUNTERPARTY-AGENT' });
    const classification = this.classify(event);
    const resolution = this.buildGroundedResponse(snapshot, reasoning, outcome, classification, event);
    const caseId = stableId('CPC', event.exportPackageId, event.eventId);
    const createdAt = now();
    const caseRecord = {
      id: caseId, caseId, exportPackageId: event.exportPackageId,
      financingTransactionId: event.financingTransactionId || snapshot.financingTransactionId,
      sourceEventId: event.eventId, eventType: event.eventType,
      topic: classification.topic, caseClass: classification.class,
      authorityRequired: resolution.authorityRequired,
      status: resolution.authorityRequired ? 'AWAITING_AUTHORITY' : resolution.status,
      nextAction: resolution.nextAction, createdAt, updatedAt: createdAt,
    };
    const responseRecord = {
      id: responseId, responseId, caseId, exportPackageId: event.exportPackageId,
      financingTransactionId: event.financingTransactionId || snapshot.financingTransactionId,
      sourceEventId: event.eventId, agentId: options.agentId || 'SRA-COUNTERPARTY-AGENT',
      status: resolution.status, response: resolution.response,
      authorityRequired: resolution.authorityRequired, nextAction: resolution.nextAction,
      groundedIn: {
        exportPackageId: snapshot.exportPackageId,
        financingTransactionId: snapshot.financingTransactionId,
        decisionId: `AD-CONTEXT-${snapshot.exportPackageId}`,
        outcomeStatus: outcome.status,
        unresolvedFields: reasoning.unresolvedFields || [],
        unresolvedServicingFields: reasoning.unresolvedServicingFields || [],
      },
      createdAt,
    };
    await this.persist(CASE_TYPE, caseId, caseRecord);
    await this.persist(RESPONSE_TYPE, responseId, responseRecord);
    if (this.gateway && typeof this.gateway.recordEvent === 'function') {
      const window = this.gateway.findWindow(event.windowId);
      if (window) await this.gateway.recordEvent(window, 'SRA_COUNTERPARTY_RESPONSE_RECORDED', {
        actorType: 'SRA_AGENT', actorName: options.agentId || 'SRA-COUNTERPARTY-AGENT',
        summary: resolution.response,
        details: { responseId, caseId, status: resolution.status, authorityRequired: resolution.authorityRequired, nextAction: resolution.nextAction },
      });
    }
    return responseRecord;
  }

  async resolveLatest(exportPackageId, options = {}) {
    await this.ensureHydrated();
    const candidates = this.participationEvents(exportPackageId).filter((event) =>
      ['PROCESSING_CLARIFICATION_REQUESTED', 'PROCESSING_EXCEPTION_REPORTED'].includes(event.eventType)
    );
    const latest = candidates[candidates.length - 1];
    if (!latest) return null;
    return await this.resolveParticipationEvent(latest.eventId, options);
  }

  statusForPackage(exportPackageId) {
    const cases = this.records(CASE_TYPE).filter((record) => record.exportPackageId === exportPackageId);
    const responses = this.records(RESPONSE_TYPE).filter((record) => record.exportPackageId === exportPackageId);
    const awaitingAuthority = cases.filter((record) => record.authorityRequired && record.status === 'AWAITING_AUTHORITY');
    const openExceptions = cases.filter((record) => record.caseClass === 'PROCESSING_EXCEPTION' && !['RESOLVED', 'CLOSED'].includes(record.status));
    return {
      phase: 5,
      status: awaitingAuthority.length ? 'AWAITING_AUTHORITY' : openExceptions.length ? 'EXCEPTION_RESOLUTION_ACTIVE' : responses.length ? 'COUNTERPARTY_OPERATIONS_ACTIVE' : 'AWAITING_COUNTERPARTY_REQUEST',
      caseCount: cases.length,
      responseCount: responses.length,
      awaitingAuthorityCount: awaitingAuthority.length,
      openExceptionCount: openExceptions.length,
      latestResponse: responses.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null,
    };
  }
}

export { CASE_TYPE as CounterpartyOperationCaseType, RESPONSE_TYPE as CounterpartyOperationResponseType };
