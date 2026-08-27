import { SraCoinAgentService } from './sra-coin-agent-service.js';
import { ContextInstructionReasoningService } from './context-instruction-reasoning-service.js';

const TRANSACTION_TYPE = 'SRA_TRANSACTION';

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
  constructor(domain, orderReviewService = null, coreHeartbeat = null) {
    this.domain = domain;
    this.orderReviewService = orderReviewService;
    this.coreHeartbeat = coreHeartbeat;
    this.coinAgents = new SraCoinAgentService(domain);
    this.contextReasoning = new ContextInstructionReasoningService(domain);
  }

  transactions() { return this.domain.list(TRANSACTION_TYPE); }

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

  build() {
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
        const context = this.contextReasoning.recordReasoning(pkg.exportPackageId, 'SRA-EXPORT-AGENT');
        queue.push({
          ...item(pkg.exportPackageId, 'FINANCING_EXPORT', pkg.state, pkg.borrowerParticipantId || pkg.participantId, 'PREPARE_SETTLEMENT_METHOD', 'Financing export is ready. SRA Export Agent should prepare the selected settlement path: bank rail instructions or the dealer funding package.', pkg),
          agentId: 'SRA-EXPORT-AGENT',
          agentType: 'EXPORT_AGENT',
          humanApprovalRequired: true,
          availableActions: ['PREPARE_BANK_SETTLEMENT_INSTRUCTION', 'GENERATE_DEALER_FUNDING_PACKAGE'],
          instructionReasoning: {
            requiredDocuments: context.reasoning.requiredDocuments,
            unresolvedFields: context.reasoning.unresolvedFields,
            unresolvedServicingFields: context.reasoning.unresolvedServicingFields,
            flags: context.reasoning.flags,
            readyForInstructionGeneration: context.reasoning.readyForInstructionGeneration,
            decisionId: context.decision.decisionId,
            planId: context.plan.planId,
          },
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
        'NO_SILENT_EXTERNAL_EXECUTION', 'COIN_AGENTS_EXPLAIN_AND_PREPARE_ONLY',
      ],
    };
  }

  explain() {
    const result = this.build();
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
}
