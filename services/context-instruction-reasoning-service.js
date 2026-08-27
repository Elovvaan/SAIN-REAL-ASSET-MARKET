import { OperationalIntelligenceService } from './operational-intelligence-service.js';

function first(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return null;
}

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export class ContextInstructionReasoningService {
  constructor(domain, intelligence = null) {
    if (!domain) throw new Error('Context reasoning requires the SRA domain store.');
    this.domain = domain;
    this.intelligence = intelligence || new OperationalIntelligenceService(domain);
  }

  exportContext(exportPackageId) {
    const pkg = this.domain.get('EXPORT_PACKAGE', exportPackageId);
    if (!pkg) throw new Error('Export package was not found.');
    const closing = pkg.closingId ? this.domain.get('FINANCING_CLOSING', pkg.closingId) : null;
    const opportunity = pkg.opportunityId ? this.domain.get('FUNDING_OPPORTUNITY', pkg.opportunityId) : null;
    const participantId = pkg.borrowerParticipantId || pkg.participantId || opportunity?.applicantParticipantId || null;
    const participant = participantId ? this.domain.get('PARTICIPANT', participantId) : null;
    const profile = opportunity?.transactionProfile || {};
    const financingTransactionId = pkg.financingTransactionId || closing?.financingTransactionId || null;
    return {
      pkg,
      closing,
      opportunity,
      participant,
      profile,
      participantId,
      financingTransactionId,
      history: this.intelligence.contextFor(financingTransactionId || exportPackageId),
    };
  }

  reasonForExportPackage(exportPackageId) {
    const context = this.exportContext(exportPackageId);
    const { pkg, closing, opportunity, profile, financingTransactionId, history } = context;
    const exportKind = upper(pkg.exportKind);
    const isFinancingDisbursement = exportKind === 'FINANCING_DISBURSEMENT';
    const vehicleLike = Boolean(first(profile.vin, profile.vehicleYear, profile.vehicleMake, profile.vehicleModel, opportunity?.vin));
    const recipientType = upper(first(profile.recipientType, profile.payeeType, vehicleLike ? 'DEALER' : null));
    const externalRecipient = Boolean(first(profile.payeeName, pkg.beneficiaryName, closing?.beneficiaryName));

    const requiredDocuments = [];
    if (isFinancingDisbursement) requiredDocuments.push('FUNDING_SETTLEMENT');
    if (isFinancingDisbursement && (recipientType === 'DEALER' || vehicleLike)) requiredDocuments.push('DEALER_PROCESSING_INSTRUCTIONS');
    if (isFinancingDisbursement) requiredDocuments.push('SERVICING_PAYMENT_INSTRUCTIONS');

    const unresolved = [];
    if (!financingTransactionId) unresolved.push('FINANCING_TRANSACTION_ID');
    if (!pkg.exportPackageId) unresolved.push('FUNDING_PACKAGE_REFERENCE');
    if (!first(profile.payeeName, pkg.beneficiaryName, closing?.beneficiaryName)) unresolved.push('RECIPIENT_OR_PAYEE');
    if (!(Number(pkg.amount) > 0)) unresolved.push('AUTHORIZED_SETTLEMENT_AMOUNT');
    if (!pkg.currency) unresolved.push('CURRENCY');
    if (!pkg.closingId && !closing?.closingId) unresolved.push('FINANCING_CLOSING_REFERENCE');

    const servicing = first(pkg.servicing, closing?.servicing, opportunity?.servicing, profile.servicing) || {};
    const terms = first(pkg.repaymentTerms, closing?.repaymentTerms, opportunity?.repaymentTerms, profile.repaymentTerms, servicing.repaymentTerms) || {};
    const unresolvedServicing = [];
    if (isFinancingDisbursement) {
      if (!first(terms.paymentFrequency, servicing.paymentFrequency, profile.paymentFrequency)) unresolvedServicing.push('PAYMENT_FREQUENCY');
      if (!first(terms.paymentAmount, terms.scheduledPaymentAmount, servicing.scheduledPaymentAmount, profile.scheduledPaymentAmount)) unresolvedServicing.push('SCHEDULED_PAYMENT_AMOUNT');
      if (!first(terms.firstPaymentDate, servicing.firstPaymentDate, profile.firstPaymentDate)) unresolvedServicing.push('FIRST_PAYMENT_DATE');
      if (!first(terms.paymentMethod, servicing.paymentMethod, profile.servicingPaymentMethod)) unresolvedServicing.push('SERVICING_PAYMENT_METHOD');
    }

    const historySignals = unique([
      ...history.events.map((record) => record.eventType),
      ...history.outcomes.map((record) => record.status),
      ...history.memories.map((record) => record.memoryType),
    ]);

    const flags = [];
    if (unresolved.length) flags.push({ code: 'UNRESOLVED_TRANSACTION_FIELDS', fields: unresolved, instruction: 'FLAG_DO_NOT_INFER' });
    if (unresolvedServicing.length) flags.push({ code: 'UNRESOLVED_SERVICING_FIELDS', fields: unresolvedServicing, instruction: 'LEAVE_BLANK_AND_FLAG' });
    if (externalRecipient && isFinancingDisbursement) flags.push({ code: 'EXTERNAL_RECIPIENT_HANDOFF', instruction: 'INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS' });

    return {
      exportPackageId: pkg.exportPackageId,
      financingTransactionId,
      exportKind,
      recipientType: recipientType || null,
      externalRecipient,
      requiredDocuments: unique(requiredDocuments),
      unresolvedFields: unresolved,
      unresolvedServicingFields: unresolvedServicing,
      flags,
      historySignals,
      readyForInstructionGeneration: isFinancingDisbursement && unresolved.length === 0,
      instructionPolicy: {
        useRecordedTransactionStateOnly: true,
        inferMissingSettlementFields: false,
        inferMissingServicingTerms: false,
      },
    };
  }

  recordReasoning(exportPackageId, agentId = 'SRA-EXPORT-AGENT') {
    const reasoning = this.reasonForExportPackage(exportPackageId);
    const transactionId = reasoning.financingTransactionId || reasoning.exportPackageId;
    const decisionId = `AD-CONTEXT-${reasoning.exportPackageId}`;
    const planId = `AP-CONTEXT-${reasoning.exportPackageId}`;

    let decision = this.intelligence.records('AGENT_DECISION').find((record) => record.decisionId === decisionId || record.id === decisionId);
    if (!decision) {
      decision = this.intelligence.recordDecision({
        decisionId,
        agentId,
        decision: reasoning.readyForInstructionGeneration ? 'GENERATE_CONTEXT_REQUIRED_INSTRUCTIONS' : 'FLAG_UNRESOLVED_CONTEXT',
        reason: reasoning.readyForInstructionGeneration
          ? `Required documents: ${reasoning.requiredDocuments.join(', ')}`
          : `Unresolved fields: ${reasoning.unresolvedFields.join(', ')}`,
        evidence: reasoning.historySignals,
        transactionId,
        authorityRequired: false,
      });
    }

    let plan = this.intelligence.records('ACTION_PLAN').find((record) => record.planId === planId || record.id === planId);
    if (!plan) {
      const steps = reasoning.requiredDocuments.map((documentType) => ({
        id: documentType,
        action: 'INCLUDE_DOCUMENT',
        documentType,
        status: 'REQUIRED',
      }));
      for (const flag of reasoning.flags) {
        steps.push({ id: flag.code, action: flag.instruction, fields: flag.fields || [], status: 'REQUIRED' });
      }
      plan = this.intelligence.createPlan({
        planId,
        goal: 'Assemble transaction instructions from recorded context without inventing missing fields.',
        transactionId,
        createdByAgentId: agentId,
        sourceDecisionId: decision.decisionId,
        steps,
        status: reasoning.readyForInstructionGeneration ? 'READY' : 'BLOCKED_CONTEXT_REQUIRED',
      });
    }

    return { reasoning, decision, plan };
  }
}
