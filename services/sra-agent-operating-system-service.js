import { SraCoinAgentService } from './sra-coin-agent-service.js';

function now() { return new Date().toISOString(); }
function count(domain, type, predicate = () => true) { return domain.list(type).filter(predicate).length; }

const BOUNDARY = Object.freeze([
  'EXPLAIN_AND_PREPARE_ONLY',
  'NO_SELF_APPROVAL',
  'NO_UNAUTHORIZED_VALUE_MOVEMENT',
  'NO_OWNERSHIP_CHANGE_OUTSIDE_SETTLEMENT',
  'NO_POLICY_BYPASS',
]);

export class SraAgentOperatingSystemService {
  constructor(domain, { operationsQueue = null, coreHeartbeat = null } = {}) {
    this.domain = domain;
    this.operationsQueue = operationsQueue;
    this.coreHeartbeat = coreHeartbeat;
    this.coinAgents = new SraCoinAgentService(domain);
  }

  registry() {
    return [
      { agentId: 'SRA-COIN-AGENT', agentType: 'COIN_AGENT', scope: 'COIN_POSITION', state: 'ACTIVE', recordCount: this.coinAgents.status().coinAgentCount, capabilities: ['EXPLAIN_ORIGIN', 'TRACE_LINEAGE', 'REPORT_RESTRICTIONS', 'IDENTIFY_NEXT_ACTION'] },
      { agentId: 'SRA-LISTING-AGENT', agentType: 'LISTING_AGENT', scope: 'MARKETPLACE_LISTING', state: 'ACTIVE', recordCount: count(this.domain, 'MARKETPLACE_LISTING'), capabilities: ['REPORT_LISTING_STATE', 'REPORT_READINESS', 'IDENTIFY_PUBLICATION_ACTION'] },
      { agentId: 'SRA-ORDER-AGENT', agentType: 'ORDER_AGENT', scope: 'PARTICIPANT_ORDER_INTENT_AND_MATCH', state: 'ACTIVE', recordCount: count(this.domain, 'SRA_TRANSACTION', (item) => ['PARTICIPANT_ORDER_INTENT', 'ORDER_MATCH_REVIEW', 'PRE_ALLOCATION_RESERVATION', 'POSITION_ALLOCATION_APPROVAL'].includes(item.transactionType)), capabilities: ['REPORT_ORDER_STATE', 'REPORT_MATCH_STATE', 'IDENTIFY_NEXT_GOVERNED_ACTION'] },
      { agentId: 'SRA-SETTLEMENT-AGENT', agentType: 'SETTLEMENT_AGENT', scope: 'ATOMIC_ORDER_SETTLEMENT', state: 'ACTIVE', recordCount: count(this.domain, 'SRA_TRANSACTION', (item) => item.transactionType === 'ATOMIC_ORDER_SETTLEMENT'), capabilities: ['REPORT_SETTLEMENT_STATE', 'VERIFY_SETTLEMENT_LINEAGE', 'REPORT_SETTLEMENT_BLOCKERS'] },
      { agentId: 'SRA-EXPORT-AGENT', agentType: 'EXPORT_AGENT', scope: 'EXPORT_AND_EXTERNAL_TRANSFER', state: 'ACTIVE', recordCount: count(this.domain, 'EXPORT_PACKAGE') + count(this.domain, 'SRA_TRANSACTION', (item) => String(item.transactionType || '').startsWith('EXTERNAL_TRANSFER_')), capabilities: ['REPORT_EXPORT_STATE', 'REPORT_TRANSFER_STATE', 'IDENTIFY_RECONCILIATION_ACTION'] },
      { agentId: 'SRA-MARKETPLACE-AGENT', agentType: 'MARKETPLACE_AGENT', scope: 'SRA_MARKET', state: 'ACTIVE', recordCount: count(this.domain, 'MARKETPLACE_LISTING'), capabilities: ['REPORT_MARKET_INVENTORY', 'REPORT_MARKET_READINESS', 'REPORT_MARKET_EXCEPTIONS'] },
    ];
  }

  brief() {
    const registry = this.registry();
    const queue = this.operationsQueue?.explain?.() || null;
    const heartbeat = this.coreHeartbeat?.status?.() || null;
    const attention = queue?.totalExceptions || 0;
    const waiting = queue?.totalAwaitingAction || 0;
    return {
      operatingSystem: 'SAIN_AGENT_OS',
      state: attention ? 'ATTENTION_REQUIRED' : waiting ? 'ACTION_REQUIRED' : 'CURRENT',
      generatedAt: now(),
      registeredAgentCount: registry.length,
      activeAgentCount: registry.filter((item) => item.state === 'ACTIVE').length,
      agents: registry,
      coordination: { waitingGovernedActions: waiting, exceptions: attention, nextRecommendedAction: queue?.nextRecommendedAction || null, heartbeatState: heartbeat?.schedulerState || heartbeat?.state || null, completedCycles: heartbeat?.cycleCount || heartbeat?.completedCycleCount || 0 },
      authorityBoundary: BOUNDARY,
      explanation: attention ? `${attention} lifecycle exception${attention === 1 ? '' : 's'} require human attention across the registered agents.` : waiting ? `${waiting} governed action${waiting === 1 ? '' : 's'} are waiting across the registered agents.` : 'All registered agents currently report no waiting governed action.',
    };
  }
}
