import { SraCoinAgentService } from './sra-coin-agent-service.js';
import { ContextInstructionReasoningService } from './context-instruction-reasoning-service.js';
import { GovernedActionExecutionService } from './governed-action-execution-service.js';
import { ExternalOutcomeReconciliationService } from './external-outcome-reconciliation-service.js';

const TRANSACTION_TYPE = 'SRA_TRANSACTION';
const INTELLIGENCE_RECORD_TYPES = Object.freeze([
  'OPERATIONAL_EVENT',
  'OPERATIONAL_MEMORY',
  'AGENT_DECISION',
  'ACTION_PLAN',
  'ACTION_RESULT',
  'OUTCOME_EVALUATION',
  'TRANSACTION_PARTICIPATION_WINDOW',
  'TRANSACTION_PARTICIPATION_EVENT',
]);

function now() { return new Date().toISOString(); }
function sortByTime(items) { return [...items].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))); }
function item(id, stage, state, participantId, action, explanation, record = {}) {
  return {
    id,
    stage,
    state,
    participantId: participantId || null,
    positionId: record.positionId || record.buyerPositionId || record.sellerPositionId || null,
    listingId: record.listingId || null,
    instrumentId: record.instrumentId || null,
    exportPackageId: record.exportPackageId || null,
    opportunityId: record.opportunityId || null,
    closingId: record.closingId || null,
    beneficiaryName: record.beneficiaryName || null,
    amount: Number(record.amount || 0) || null,
    currency: record.currency || null,
    quantity: Number(record.quantity || record.matchedQuantity || 0) || null,
    valueAmount: Number(record.valueAmount || record.proposedNotional || 0) || null,
    nextAction: action,
    explanation,
    updatedAt: record.updatedAt || record.createdAt || null,
  };
}

export class UnifiedMarketOperationsQueueService {
  constructor(domain, orderReviewService = null, coreHeartbeat = null, options = {}) {
    this.domain = domain;
    this.orderReviewService = orderReviewService;
    this.coreHeartbeat = coreHeartbeat;
    this.coinAgents = new SraCoinAgentService(domain);
    this.contextReasoning = new ContextInstructionReasoningService(domain);
    this.actionExecution = options.actionExecution || new GovernedActionExecutionService(domain, options.actionExecutionOptions || {});
    this.outcomeReconciliation = options.outcomeReconciliation || new ExternalOutcomeReconciliationService(domain);
    this.intelligenceHydrated = false;
    this.intelligenceHydrationPromise = null;
  }

  transactions() { return this.domain.list(TRANSACTION_TYPE); }

  async ensureIntelligenceHydrated() {
    if (this.intelligenceHydrated) return;
    if (typeof this.domain.hydrate !== 'function') {
      this.intelligenceHydrated = true;
      return;
    }
    if (!this.intelligenceHydrationPromise) {
      this.intelligenceHydrationPromise = Promise.resolve(this.domain.hydrate(INTELLIGENCE_RECORD_TYPES))
        .then(() => { this.intelligenceHydrated = true; })
        .finally(() => { this.intelligenceHydrationPromise = null; });
    }
    await this.intelligenceHydrationPromise;
  }

  attachCoinAgent(entry) {
    if (!entry.positionId) return entry;
    try {
      const agent = this.coinAgents.explain(entry.positionId);
      return {
        ...entry,
        coinAgent: {
          agentId: agent.agentId,
          positionId: agent.positionId,
          currentState: agent.currentState,
          blockers: agent.blockers,
          nextEligibleAction: agent.nextEligibleAction,
          humanApprovalRequired: agent.humanApprovalRequired,
          explanation: agent.explanation,
        },
      };
    } catch {
      return entry;
    }
  }

  build(contextRecords = new Map(), outcomeRecords = new Map()) {
    const tx = this.transactions();
    const queue = [];
    const exceptions = [];

    for (const record of tx) {
      if (record.transactionType === 'PARTICIPANT_ORDER_INTENT' && record.state === 'QUEUED_FOR_ORDER_REVIEW') {
        queue.push(item(record.orderIntentId || record.transactionId, 'ORDER_INTENT', record.state, record.participantId, 'REVIEW_MATCH', 'Participant intent is confirmed and waiting for a compatible counter-side order.', record));
      }
      if (record.transactionType === 'ORDER_MATCH_REVIEW' && record.state === 'MATCH_APPROVED_PENDING_ALLOCATION' && !record.reservationId) {
        queue.push(item(record.matchReviewId || record.transactionId, 'MATCH_REVIEW', record.state, null, 'RESERVE', 'Approved match is waiting for buyer-value and seller-position holds.', record));
      }
      if (record.transactionType === 'PRE_ALLOCATION_RESERVATION' && record.state === 'RESERVED_PENDING_ALLOCATION_APPROVAL') {
        const entry = item(record.reservationId || record.transactionId, 'RESERVATION', record.state, null, 'ALLOCATE', 'Both protected holds are active. Allocation approval is the next governed action.', record);
        entry.positionId = record.positionReservation?.positionId || record.sellerPositionId || entry.positionId;
        queue.push(entry);
      }
      if (record.transactionType === 'POSITION_ALLOCATION_APPROVAL' && record.state === 'ALLOCATION_APPROVED_PENDING_SETTLEMENT') {
        queue.push(item(record.allocationId || record.transactionId, 'ALLOCATION', record.state, record.buyerParticipantId, 'SETTLE', 'Buyer position is allocated pending settlement. Funding and position holds remain active.', record));
      }
      if (record.transactionType === 'ATOMIC_ORDER_SETTLEMENT' && record.state === 'SETTLED' && !record.exportPackageId) {
        queue.push(item(record.settlementId || record.transactionId, 'SETTLEMENT', record.state, record.buyerParticipantId, 'EXPORT', 'Settlement and ownership recognition are complete. Export eligibility can now be reviewed.', record));
      }
      if (record.transactionType === 'EXTERNAL_TRANSFER_INSTRUCTION' && record.state === 'TRANSFER_INSTRUCTION_VERIFIED' && record.executionState === 'NOT_AUTHORIZED') {
        queue.push(item(record.transferInstructionId || record.transactionId, 'TRANSFER_INSTRUCTION', record.state, record.participantId, 'AUTHORIZE_EXECUTION', 'Destination and route are verified. External execution still requires separate authorization.', record));
      }
      if (record.transactionType === 'EXTERNAL_TRANSFER_EXECUTION_AUTHORIZATION' && record.state === 'EXECUTION_AUTHORIZED' && !record.reconciliationState) {
        queue.push(item(record.executionAuthorizationId || record.transactionId, 'EXTERNAL_EXECUTION', record.state, record.participantId, 'RECONCILE_RESULT', 'Execution is authorized and waiting for a verified external result.', record));
      }
      if (record.transactionType === 'EXTERNAL_TRANSFER_RESULT' && record.result === 'FAILED') {
        exceptions.push(item(record.transferResultId || record.transactionId, 'TRANSFER_EXCEPTION', record.state || 'FAILED', record.participantId, 'REVIEW_FAILURE', `External transfer failed${record.failureReason ? `: ${record.failureReason}` : '.'}`, record));
      }
    }

    for (const pkg of this.domain.list('EXPORT_PACKAGE')) {
      if (String(pkg.exportKind || '').toUpperCase() === 'FINANCING_DISBURSEMENT' && String(pkg.state || '').toUpperCase() === 'READY_FOR_SETTLEMENT_INSTRUCTION') {
        const persisted = contextRecords.get(pkg.exportPackageId) || null;
        const reasoning = persisted?.reasoning || this.contextReasoning.reasonForExportPackage(pkg.exportPackageId);
        const decisionId = persisted?.decision?.decisionId || `AD-CONTEXT-${pkg.exportPackageId}`;
        const planId = persisted?.plan?.planId || `AP-CONTEXT-${pkg.exportPackageId}`;
        const plan = persisted?.plan || this.domain.list('ACTION_PLAN').find((record) => record.planId === planId || record.id === planId) || null;
        const executionSummary = this.actionExecution.summarizePlan(plan, pkg.exportPackageId);
        const outcomeSummary = outcomeRecords.get(pkg.exportPackageId) || this.outcomeReconciliation.summary(pkg.exportPackageId);
        const phase4NeedsAttention = outcomeSummary.attentionRequired;
        const nextAction = phase4NeedsAttention
          ? 'REVIEW_EXTERNAL_OUTCOME'
          : outcomeSummary.awaitingExternalConfirmation
            ? 'AWAIT_EXTERNAL_CONFIRMATION'
            : 'PREPARE_SETTLEMENT_METHOD';
        const explanation = phase4NeedsAttention
          ? 'External processing evidence reports an exception or failed outcome. SRA should reconcile the outside response before continuing.'
          : outcomeSummary.awaitingExternalConfirmation
            ? 'The external participant reported submission for processing. Independent confirmation is still outstanding.'
            : 'Financing export is ready. SRA Export Agent should prepare the selected settlement path: bank rail instructions or the dealer funding package.';
        queue.push({
          ...item(pkg.exportPackageId, 'FINANCING_EXPORT', pkg.state, pkg.borrowerParticipantId || pkg.participantId, nextAction, explanation, pkg),
          agentId: phase4NeedsAttention ? 'SRA-OUTCOME-AGENT' : 'SRA-EXPORT-AGENT',
          agentType: phase4NeedsAttention ? 'OUTCOME_RECONCILIATION_AGENT' : 'EXPORT_AGENT',
          humanApprovalRequired: true,
          availableActions: ['PREPARE_BANK_SETTLEMENT_INSTRUCTION', 'GENERATE_DEALER_FUNDING_PACKAGE', 'RECONCILE_EXTERNAL_OUTCOME'],
          instructionReasoning: {
            requiredDocuments: reasoning.requiredDocuments,
            unresolvedFields: reasoning.unresolvedFields,
            unresolvedServicingFields: reasoning.unresolvedServicingFields,
            flags: reasoning.flags,
            readyForInstructionGeneration: reasoning.readyForInstructionGeneration,
            decisionId,
            planId,
          },
          actionExecution: {
            phase: 3,
            executable: reasoning.readyForInstructionGeneration,
            expectedCount: executionSummary.expectedCount,
            resultCount: executionSummary.resultCount,
            completedCount: executionSummary.completedCount,
            awaitingAuthorityCount: executionSummary.awaitingAuthorityCount,
            failedCount: executionSummary.failedCount,
            pendingCount: executionSummary.pendingCount,
            status: reasoning.readyForInstructionGeneration
              ? executionSummary.status
              : 'BLOCKED_CONTEXT_REQUIRED',
          },
          outcomeReconciliation: outcomeSummary,
        });
      }
      if (pkg.state === 'READY_FOR_EXPORT' && !pkg.transferInstructionId) {
        queue.push({
          ...item(pkg.exportPackageId, 'EXPORT_PACKAGE', pkg.state, pkg.participantId, 'TRANSFER_INSTRUCTION', 'Export package is authorized and waiting for destination verification.', pkg),
          agentId: 'SRA-EXPORT-AGENT',
          agentType: 'EXPORT_AGENT',
          humanApprovalRequired: true,
        });
      }
      if (pkg.state === 'TRANSFER_INSTRUCTION_VERIFIED' && pkg.exportExecutionState === 'AWAITING_EXECUTION_AUTHORIZATION') {
        queue.push({
          ...item(pkg.exportPackageId, 'EXPORT_PACKAGE', pkg.state, pkg.participantId, 'AUTHORIZE_EXECUTION', 'Transfer instruction is verified and awaiting execution authorization.', pkg),
          agentId: 'SRA-EXPORT-AGENT',
          agentType: 'EXPORT_AGENT',
          humanApprovalRequired: true,
        });
      }
      if (pkg.exportExecutionState === 'FAILED') {
        exceptions.push({
          ...item(pkg.exportPackageId, 'EXPORT_EXCEPTION', pkg.state, pkg.participantId, 'REVIEW_FAILURE', 'Export execution failed and requires administrator review.', pkg),
          agentId: 'SRA-EXPORT-AGENT',
          agentType: 'EXPORT_AGENT',
          humanApprovalRequired: true,
        });
      }
    }

    const orderedQueue = sortByTime(queue).map((entry) => this.attachCoinAgent(entry));
    const orderedExceptions = sortByTime(exceptions).map((entry) => this.attachCoinAgent(entry));
    const counts = orderedQueue.reduce((map, entry) => {
      map[entry.stage] = (map[entry.stage] || 0) + 1;
      return map;
    }, {});
    const heartbeat = this.coreHeartbeat?.status?.() || null;
    const coinAgentStatus = this.coinAgents.status();

    return {
      generatedAt: now(),
      state: orderedExceptions.length ? 'ATTENTION_REQUIRED' : orderedQueue.length ? 'ACTION_REQUIRED' : 'CURRENT',
      totalAwaitingAction: orderedQueue.length,
      totalExceptions: orderedExceptions.length,
      counts,
      queue: orderedQueue,
      exceptions: orderedExceptions,
      coinAgents: coinAgentStatus,
      platformPulse: heartbeat ? {
        schedulerState: heartbeat.schedulerState || heartbeat.state || null,
        latestCycle: heartbeat.latestCycle || null,
        completedCycles: heartbeat.cycleCount || heartbeat.completedCycleCount || 0,
        failedEngines: heartbeat.latestCycle?.failedEngineCount || 0,
      } : null,
      protectedBoundary: [
        'NO_AUTOMATIC_APPROVAL', 'NO_BATCH_STATE_CHANGE', 'NO_SILENT_SETTLEMENT',
        'NO_SILENT_EXTERNAL_EXECUTION', 'EXTERNAL_SELF_REPORT_IS_EVIDENCE_NOT_VERIFICATION',
        'COIN_AGENTS_EXPLAIN_AND_PREPARE_ONLY',
      ],
    };
  }

  async buildPersisted() {
    await this.ensureIntelligenceHydrated();
    const contextRecords = new Map();
    const outcomeRecords = new Map();
    for (const pkg of this.domain.list('EXPORT_PACKAGE')) {
      if (String(pkg.exportKind || '').toUpperCase() !== 'FINANCING_DISBURSEMENT') continue;
      if (String(pkg.state || '').toUpperCase() !== 'READY_FOR_SETTLEMENT_INSTRUCTION') continue;
      const context = await this.contextReasoning.recordReasoning(pkg.exportPackageId, 'SRA-EXPORT-AGENT');
      contextRecords.set(pkg.exportPackageId, context);
      await this.outcomeReconciliation.reconcile(pkg.exportPackageId);
      outcomeRecords.set(pkg.exportPackageId, this.outcomeReconciliation.summary(pkg.exportPackageId));
    }
    return this.build(contextRecords, outcomeRecords);
  }

  async executeFinancingPlan(exportPackageId, options = {}) {
    if (!exportPackageId) throw new Error('exportPackageId is required.');
    await this.ensureIntelligenceHydrated();
    const context = await this.contextReasoning.recordReasoning(exportPackageId, 'SRA-EXPORT-AGENT');
    return await this.actionExecution.executePlan(context.plan.planId, {
      exportPackageId,
      agentId: options.agentId || 'SRA-EXPORT-AGENT',
    });
  }

  async reconcileFinancingOutcome(exportPackageId) {
    if (!exportPackageId) throw new Error('exportPackageId is required.');
    await this.ensureIntelligenceHydrated();
    const reconciled = await this.outcomeReconciliation.reconcile(exportPackageId);
    return {
      ...reconciled,
      summary: this.outcomeReconciliation.summary(exportPackageId),
    };
  }

  explainResult(result) {
    const next = result.exceptions[0] || result.queue[0] || null;
    return {
      ...result,
      summary: result.totalExceptions
        ? `${result.totalExceptions} exception${result.totalExceptions === 1 ? '' : 's'} require administrator attention.`
        : result.totalAwaitingAction
          ? `${result.totalAwaitingAction} governed action${result.totalAwaitingAction === 1 ? '' : 's'} are waiting.`
          : 'No governed market operations are waiting.',
      nextRecommendedAction: next ? {
        id: next.id,
        stage: next.stage,
        action: next.nextAction,
        agentId: next.agentId || null,
        explanation: next.coinAgent?.explanation || next.explanation,
      } : null,
    };
  }

  explain() {
    return this.explainResult(this.build());
  }

  async explainPersisted() {
    return this.explainResult(await this.buildPersisted());
  }
}
