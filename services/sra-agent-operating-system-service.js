import { SraCoinAgentService } from './sra-coin-agent-service.js';
import { getSraAgentServiceFee } from '../config/agent-service-fee-schedule.js';

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
    const definitions = [
      { agentId:'SRA-COIN-AGENT',name:'Coin Operations Agent',agentType:'COIN_AGENT',scope:'OBSERVATION_TO_COIN_POSITION_AND_ON_CHAIN_PREPARATION',recordCount:this.coinAgents.status().coinAgentCount,capabilities:['EXPLAIN_ORIGIN','TRACE_LINEAGE','REPORT_RESTRICTIONS','IDENTIFY_NEXT_ACTION','PREPARE_INSTRUMENT_HANDOFF','PREPARE_ON_CHAIN_REPRESENTATION','PREPARE_RECONCILIATION'] },
      { agentId:'SRA-LISTING-AGENT',name:'Listing Operations Agent',agentType:'LISTING_AGENT',scope:'LISTING_PREPARATION_AND_PUBLICATION',recordCount:count(this.domain,'MARKETPLACE_LISTING'),capabilities:['REPORT_LISTING_STATE','REPORT_READINESS','PREPARE_PUBLICATION_ACTION'] },
      { agentId:'SRA-ORDER-AGENT',name:'Order Operations Agent',agentType:'ORDER_AGENT',scope:'PARTICIPANT_ORDER_INTENT_AND_MATCH',recordCount:count(this.domain,'SRA_TRANSACTION',(item)=>['PARTICIPANT_ORDER_INTENT','ORDER_MATCH_REVIEW','PRE_ALLOCATION_RESERVATION','POSITION_ALLOCATION_APPROVAL'].includes(item.transactionType)),capabilities:['REPORT_ORDER_STATE','REPORT_MATCH_STATE','PREPARE_NEXT_GOVERNED_ACTION'] },
      { agentId:'SRA-SETTLEMENT-AGENT',name:'Settlement Operations Agent',agentType:'SETTLEMENT_AGENT',scope:'ALLOCATION_AND_ATOMIC_SETTLEMENT',recordCount:count(this.domain,'SRA_TRANSACTION',(item)=>['POSITION_ALLOCATION_APPROVAL','ATOMIC_ORDER_SETTLEMENT'].includes(item.transactionType)),capabilities:['REPORT_SETTLEMENT_STATE','VERIFY_SETTLEMENT_LINEAGE','PREPARE_SETTLEMENT_ACTION'] },
      { agentId:'SRA-EXPORT-AGENT',name:'External Rail Agent',agentType:'EXPORT_AGENT',scope:'EXPORT_SETTLEMENT_AND_EXTERNAL_TRANSFER',recordCount:count(this.domain,'EXPORT_PACKAGE')+count(this.domain,'SRA_TRANSACTION',(item)=>String(item.transactionType||'').startsWith('EXTERNAL_TRANSFER_')),capabilities:['REPORT_EXPORT_STATE','REPORT_TRANSFER_STATE','PREPARE_RECONCILIATION_ACTION'] },
      { agentId:'SRA-MARKETPLACE-AGENT',name:'Marketplace Operations Agent',agentType:'MARKETPLACE_AGENT',scope:'MARKET_READINESS_AND_OFFERS',recordCount:count(this.domain,'MARKETPLACE_LISTING')+count(this.domain,'ON_CHAIN_MARKET_OFFER'),capabilities:['REPORT_MARKET_INVENTORY','REPORT_MARKET_READINESS','PREPARE_MARKET_OFFER','REPORT_MARKET_EXCEPTIONS'] },
    ];
    return definitions.map((definition)=>({...definition,state:'ACTIVE',workflowStages:getSraAgentServiceFee(definition.agentId)?.workflowStages||[]}));
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
