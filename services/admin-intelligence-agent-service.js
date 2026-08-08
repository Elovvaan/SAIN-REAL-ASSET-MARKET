import { scanProductLifecycleProgress } from './product-lifecycle-progress-service.js';
import { explainAdminState } from './admin-state-explanation-service.js';
import { PlatformChainOperationsAgentService } from './platform-chain-operations-agent-service.js';
import { SolanaTransferService } from './solana-transfer-service.js';
import { SraCoinChainService } from './sra-coin-chain-service.js';

const PRODUCT_DEFINITION = 'SRA_PRODUCT_DEFINITION';

const PRODUCT_ALIASES = Object.freeze({
  'TRUE BILL': 'TRUE_BILL',
  'TRUE_BILL': 'TRUE_BILL',
  'COMMERCIAL PAPER': 'COMMERCIAL_PAPER',
  'ASSET BACKED NOTE': 'ASSET_BACKED_NOTE',
  'ASSET-BACKED NOTE': 'ASSET_BACKED_NOTE',
  'INVOICE FINANCE': 'INVOICE_FINANCE_INSTRUMENT',
  'PURCHASE ORDER': 'PURCHASE_ORDER_INSTRUMENT',
  'WORKING CAPITAL': 'WORKING_CAPITAL_NOTE',
  'EQUIPMENT FINANCE': 'EQUIPMENT_FINANCE_INSTRUMENT',
  'CONSTRUCTION FUNDING': 'CONSTRUCTION_FUNDING_NOTE',
  'REVENUE PARTICIPATION': 'REVENUE_PARTICIPATION_INSTRUMENT',
  'PARTICIPATION POSITION': 'PARTICIPATION_POSITION',
});

const STAGE_LABELS = Object.freeze({
  instrument: 'instrument issuance',
  listing: 'marketplace listing',
  participation: 'participation',
  commitment: 'commitment',
  allocation: 'allocation',
  settlement: 'settlement',
  ownershipRecognition: 'ownership recognition',
  exportPackage: 'ready-for-export packaging',
  onChainSynchronization: 'SRA on-chain synchronization',
});

const PROTECTED_STAGES = new Set([
  'instrument', 'listing', 'allocation', 'settlement', 'ownershipRecognition', 'exportPackage', 'onChainSynchronization',
]);

function cleanQuestion(value) {
  const question = String(value || '').trim();
  if (!question) throw new Error('question is required.');
  if (question.length > 2000) throw new Error('question exceeds the 2000 character limit.');
  return question;
}

function normalizedLabel(value) {
  return String(value || '').toUpperCase().replace(/[_-]+/g, ' ').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function activeProductDefinitions(domain) {
  return domain.list(PRODUCT_DEFINITION)
    .filter((record) => String(record?.state || '').toUpperCase() === 'ACTIVE')
    .filter((record) => String(record?.productCode || '').trim());
}

function productIndex(domain) {
  const index = new Map();
  for (const [label, code] of Object.entries(PRODUCT_ALIASES)) index.set(normalizedLabel(label), String(code).toUpperCase());
  for (const definition of activeProductDefinitions(domain)) {
    const code = String(definition.productCode).toUpperCase();
    index.set(normalizedLabel(code), code);
    if (definition.name) index.set(normalizedLabel(definition.name), code);
  }
  return index;
}

function detectProduct(domain, question) {
  const normalizedQuestion = normalizedLabel(question);
  const matches = [...productIndex(domain).entries()]
    .filter(([label]) => label && normalizedQuestion.includes(label))
    .sort((left, right) => right[0].length - left[0].length);
  return matches[0]?.[1] || null;
}

function allProductCodes(domain) {
  return [...new Set([
    ...Object.values(PRODUCT_ALIASES).map((value) => String(value).toUpperCase()),
    ...activeProductDefinitions(domain).map((record) => String(record.productCode).toUpperCase()),
  ])];
}

function intent(question, productCode) {
  const normalized = question.toLowerCase();
  if (/(chain operations|on.chain|solana|mint.*sra|sync.*sra|sra.*sync)/.test(normalized)) return 'CHAIN_OPERATIONS';
  if (/(operational brief|operations brief|what needs attention|incomplete workflows|next actions|what should i do next|work queue)/.test(normalized)) return 'OPERATIONAL_BRIEF';
  if (productCode && /(where|status|stage|progress|far|ready|block|missing|next|why)/.test(normalized)) return 'PRODUCT_LIFECYCLE';
  if (/(what.*need.*approval|approval|approve|human.*loop|my action)/.test(normalized)) return 'APPROVALS';
  if (/(platform|system).*(status|health|doing|summary)|how.*platform/.test(normalized)) return 'PLATFORM_SUMMARY';
  if (/(what can you|help|capabilit|who are you)/.test(normalized)) return 'CAPABILITIES';
  return productCode ? 'PRODUCT_LIFECYCLE' : 'UNKNOWN';
}

function nextActionFor(chain) {
  if (!chain) return null;
  if (!chain.firstMissing) return { stage: null, label: 'No internal lifecycle stage is missing.', authority: 'NONE', autonomous: true };
  const protectedAction = PROTECTED_STAGES.has(chain.firstMissing);
  return {
    stage: chain.firstMissing,
    label: `Advance the product to ${STAGE_LABELS[chain.firstMissing] || chain.firstMissing}.`,
    authority: protectedAction ? 'ADMIN_APPROVAL_REQUIRED' : 'SRA_AGENT_AUTONOMOUS',
    autonomous: !protectedAction,
  };
}

function productAnswer(progress) {
  if (!progress.instrumentCount) {
    return {
      answer: `SRA does not currently contain an instrument for ${progress.productCode}. The lifecycle has not started for this product.`,
      status: 'NOT_STARTED', blockers: ['NO_INSTRUMENT'],
      nextAction: { stage: 'instrument', label: `Create and approve the first ${progress.productCode} instrument from a recognized financial record.`, authority: 'ADMIN_APPROVAL_REQUIRED', autonomous: false },
      references: [],
    };
  }
  const lead = progress.chains[0];
  const completed = lead.completedStages.map((stage) => STAGE_LABELS[stage] || stage);
  const missing = lead.firstMissing;
  const stageText = missing ? `It has completed ${completed.join(', ')}. The first missing stage is ${STAGE_LABELS[missing] || missing}.` : 'It has completed every internal lifecycle stage and is ready for export.';
  return {
    answer: `SRA found ${progress.instrumentCount} instrument${progress.instrumentCount === 1 ? '' : 's'} for ${progress.productCode} across ${progress.instrumentFamilies.join(', ')}. The furthest chain is ${lead.instrumentId}. ${stageText}`,
    status: lead.readyForExport ? 'READY_FOR_EXPORT' : 'IN_PROGRESS',
    blockers: missing ? [`MISSING_${String(missing).replace(/([A-Z])/g, '_$1').toUpperCase()}`] : [],
    nextAction: nextActionFor(lead),
    references: Object.entries(lead.stages).filter(([, stage]) => stage?.id).map(([stage, record]) => ({ stage, recordId: record.id, state: record.state })),
  };
}

function chainAction(job) {
  if (!job) return null;
  const reconciliation = job.jobType === 'RECONCILE_SRA_CHAIN_SUPPLY';
  return {
    agent: 'SRA_PLATFORM_CHAIN_OPERATIONS_AGENT',
    jobId: job.jobId,
    jobType: job.jobType,
    productCode: 'SRA_COIN',
    instrumentId: null,
    stage: 'onChainSynchronization',
    label: reconciliation
      ? 'Review the SRA on-chain supply reconciliation exception.'
      : `${job.jobType === 'PUT_SRA_ON_CHAIN' ? 'Put' : 'Synchronize'} ${Number(job.requestedQuantity || 0)} SRA on Solana.`,
    authority: job.authority,
    autonomous: false,
    network: job.network || 'SOLANA',
    requestedQuantity: Number(job.requestedQuantity || 0),
    targetSupply: Number(job.targetSupply || job.snapshot?.platformSupply || 0),
    executable: Boolean(job.executable),
    executionAction: reconciliation ? null : 'EXECUTE_CHAIN_JOB',
    blocker: reconciliation ? 'SRA_CHAIN_RECONCILIATION_REQUIRED' : null,
  };
}

export class AdminIntelligenceAgentService {
  constructor({ domain, database = null, productQualification = null }) {
    this.domain = domain;
    this.database = database;
    this.productQualification = productQualification;
    const solana = new SolanaTransferService();
    const sraCoin = new SraCoinChainService(domain, solana);
    this.chainOperationsAgent = new PlatformChainOperationsAgentService({ domain, chainService: sraCoin, database });
  }

  capabilities() {
    return {
      agent: 'SRA_ADMIN_INTELLIGENCE_AGENT', mode: 'AUTONOMOUS_READ_AND_REASON', writeAuthority: 'HUMAN_IN_THE_LOOP',
      can: ['ANSWER_PLATFORM_STATUS','GENERATE_OPERATIONAL_BRIEF','DISCOVER_REGISTERED_PRODUCTS','TRACE_PRODUCT_LIFECYCLES','IDENTIFY_BLOCKERS','RECOMMEND_NEXT_ACTION','IDENTIFY_APPROVAL_BOUNDARIES','CITE_INTERNAL_RECORDS','EXPLAIN_ASSET_EXPORTABILITY','TRACE_ASSET_RELATIONSHIPS','SIMULATE_APPROVAL_IMPACT','DISPATCH_PLATFORM_CHAIN_OPERATIONS_AGENT'],
      delegatedAgents: [this.chainOperationsAgent.capabilities()],
      cannotWithoutApproval: ['ISSUE_INSTRUMENT','PUBLISH_LISTING','ALLOCATE_POSITION','CONFIRM_SETTLEMENT','RECOGNIZE_OWNERSHIP','CREATE_EXPORT_PACKAGE','MINT_SRA_ON_CHAIN','TRANSFER_SRA_ON_CHAIN'],
    };
  }

  chainOperationsSummary() {
    const work = this.chainOperationsAgent.workQueue();
    const actions = work.queue.map(chainAction).filter(Boolean);
    const snapshot = work.snapshot;
    return {
      answer: actions.length
        ? `The Platform Chain Operations Agent has ${actions.length} job${actions.length === 1 ? '' : 's'} requiring attention. SRA platform supply is ${snapshot.platformSupply} SRA, on-chain issued supply is ${snapshot.issuedOnChainSupply} SRA, and ${snapshot.pendingQuantity} SRA is pending synchronization.`
        : `The Platform Chain Operations Agent is clear. SRA platform supply and the current Solana projection are synchronized at ${snapshot.issuedOnChainSupply} SRA.`,
      status: work.state,
      agent: work.agent,
      workQueue: actions,
      chainSnapshot: snapshot,
      pendingActions: actions,
      nextAction: actions[0] || null,
      blockers: actions.map((action) => action.blocker).filter(Boolean),
      references: snapshot.mintAddress ? [{ stage: 'onChainSynchronization', recordId: snapshot.mintAddress, state: snapshot.state }] : [],
    };
  }

  platformSummary() {
    const snapshotAt = new Date().toISOString();
    const selected = {
      MARKET_OBSERVATION: this.domain.list('MARKET_OBSERVATION').length,
      RECOGNITION_ASSESSMENT: this.domain.list('RECOGNITION_ASSESSMENT').length,
      FINANCIAL_RECORD: this.domain.list('FINANCIAL_RECORD').length,
      COIN_POSITION: this.domain.list('COIN_POSITION').length,
      SRA_INSTRUMENT: this.domain.list('SRA_INSTRUMENT').length,
      MARKETPLACE_LISTING: this.domain.list('MARKETPLACE_LISTING').length,
      PARTICIPATION_POSITION: this.domain.list('PARTICIPATION_POSITION').length,
      FUNDING_MARKETPLACE_COMMITMENT: this.domain.list('FUNDING_MARKETPLACE_COMMITMENT').length,
      FUNDING_MARKETPLACE_POSITION: this.domain.list('FUNDING_MARKETPLACE_POSITION').length,
      SRA_SETTLEMENT_RECORD: this.domain.list('SRA_SETTLEMENT_RECORD').length,
      OWNERSHIP_RECOGNITION: this.domain.list('OWNERSHIP_RECOGNITION').length,
      EXPORT_PACKAGE: this.domain.list('EXPORT_PACKAGE').length,
    };
    const lifecycleTotal = Object.values(selected).reduce((sum, value) => sum + Number(value || 0), 0);
    const chainOperations = this.chainOperationsAgent.workQueue();
    return {
      answer: `Live SRA snapshot as of ${snapshotAt}: ${selected.MARKET_OBSERVATION} observations, ${selected.RECOGNITION_ASSESSMENT} recognitions, ${selected.FINANCIAL_RECORD} financial records, ${selected.COIN_POSITION} Coin Positions, ${selected.SRA_INSTRUMENT} instruments, ${selected.MARKETPLACE_LISTING} marketplace listings, ${selected.SRA_SETTLEMENT_RECORD} settlement records, ${selected.OWNERSHIP_RECOGNITION} ownership recognitions, and ${selected.EXPORT_PACKAGE} export-ready packages. This snapshot contains ${lifecycleTotal} stage records in total; that total is a sum across lifecycle stages, not a count of unique assets.`,
      status: 'AVAILABLE', snapshotAt, counts: selected, lifecycleTotal,
      chainOperations: { state: chainOperations.state, queuedJobs: chainOperations.queue.length, snapshot: chainOperations.snapshot },
      countMeaning: 'SUM_OF_STAGE_RECORDS_NOT_UNIQUE_ASSETS', nextAction: null, blockers: [], references: [],
    };
  }

  approvalSummary() {
    const pending = [];
    for (const productCode of allProductCodes(this.domain)) {
      const progress = scanProductLifecycleProgress(this.domain, productCode);
      for (const chain of progress.chains || []) {
        const action = nextActionFor(chain);
        if (action?.authority === 'ADMIN_APPROVAL_REQUIRED') pending.push({ productCode, instrumentId: chain.instrumentId, ...action });
      }
    }
    const chainActions = this.chainOperationsAgent.workQueue().queue.map(chainAction).filter(Boolean);
    pending.push(...chainActions);
    return {
      answer: pending.length ? `SRA identified ${pending.length} action${pending.length === 1 ? '' : 's'} at a human approval or review boundary, including delegated agent work.` : 'SRA did not identify a currently reachable action requiring administrator approval.',
      status: pending.length ? 'APPROVAL_REQUIRED' : 'NO_PENDING_APPROVAL', pendingActions: pending, blockers: chainActions.map((item) => item.blocker).filter(Boolean),
      references: pending.filter((item) => item.instrumentId || item.jobId).map((item) => ({ stage: item.stage, recordId: item.instrumentId || item.jobId, state: item.authority || null })),
      nextAction: pending[0] || null,
    };
  }

  operationalBrief() {
    const snapshot = this.platformSummary();
    const approvals = this.approvalSummary();
    const workflows = [];
    for (const productCode of allProductCodes(this.domain)) {
      const progress = scanProductLifecycleProgress(this.domain, productCode);
      for (const chain of progress.chains || []) {
        if (!chain.firstMissing) continue;
        const action = nextActionFor(chain);
        workflows.push({ productCode, instrumentId: chain.instrumentId, completedStages: chain.completedStages, firstMissing: chain.firstMissing, blocker: `MISSING_${String(chain.firstMissing).replace(/([A-Z])/g, '_$1').toUpperCase()}`, nextAction: action });
      }
    }
    for (const job of this.chainOperationsAgent.workQueue().queue) {
      const action = chainAction(job);
      workflows.push({
        agent: action.agent,
        jobId: action.jobId,
        productCode: 'SRA_COIN',
        instrumentId: null,
        completedStages: ['coinPositionSupply'],
        firstMissing: 'onChainSynchronization',
        blocker: action.blocker || 'PENDING_SRA_ON_CHAIN_SYNCHRONIZATION',
        nextAction: action,
      });
    }
    workflows.sort((a, b) => Number(Boolean(String(b.nextAction?.authority || '').startsWith('ADMIN_'))) - Number(Boolean(String(a.nextAction?.authority || '').startsWith('ADMIN_'))) || String(a.productCode).localeCompare(String(b.productCode)));
    const autonomous = workflows.filter((item) => item.nextAction?.authority === 'SRA_AGENT_AUTONOMOUS');
    const protectedQueue = workflows.filter((item) => String(item.nextAction?.authority || '').startsWith('ADMIN_'));
    const readyForExport = snapshot.counts.EXPORT_PACKAGE;
    const attention = protectedQueue.length + autonomous.length;
    const answer = attention
      ? `Operational brief as of ${snapshot.snapshotAt}: ${readyForExport} export-ready package${readyForExport === 1 ? '' : 's'}, ${protectedQueue.length} action${protectedQueue.length === 1 ? '' : 's'} waiting at an administrator boundary, and ${autonomous.length} reachable internal action${autonomous.length === 1 ? '' : 's'}. The highest-priority next action is ${workflows[0]?.nextAction?.label || 'not available'}`
      : `Operational brief as of ${snapshot.snapshotAt}: ${readyForExport} export-ready package${readyForExport === 1 ? '' : 's'} and no currently reachable incomplete workflow requires attention.`;
    return {
      answer, status: attention ? 'ATTENTION_REQUIRED' : 'CLEAR', snapshotAt: snapshot.snapshotAt,
      counts: snapshot.counts, pendingActions: approvals.pendingActions, incompleteWorkflows: workflows,
      administratorQueue: protectedQueue, autonomousQueue: autonomous,
      delegatedAgents: { chainOperations: this.chainOperationsAgent.workQueue() },
      nextAction: workflows[0]?.nextAction || null,
      blockers: workflows.map((item) => item.blocker),
      references: workflows.filter((item) => item.instrumentId || item.jobId).map((item) => ({ stage: item.firstMissing, recordId: item.instrumentId || item.jobId, state: 'INCOMPLETE' })),
    };
  }

  async executeChainJob(input = {}, actor = {}) {
    const result = await this.chainOperationsAgent.execute(input.jobId, input, actor);
    return {
      agent: 'SRA_ADMIN_INTELLIGENCE_AGENT',
      delegatedAgent: result.agent,
      intent: 'CHAIN_OPERATIONS_EXECUTION',
      authorityMode: 'HUMAN_IN_THE_LOOP',
      answeredAt: new Date().toISOString(),
      answer: `Approved Chain Operations job ${result.job.jobId} completed. On-chain SRA supply is now ${result.reconciliation.issuedOnChainSupply} SRA.`,
      status: result.state,
      job: result.job,
      result: result.result,
      reconciliation: result.reconciliation,
      blockers: result.state === 'RECONCILIATION_REQUIRED' ? ['SRA_CHAIN_RECONCILIATION_REQUIRED'] : [],
      references: result.result?.transactionSignature ? [{ stage: 'onChainSynchronization', recordId: result.result.transactionSignature, state: result.state }] : [],
      nextAction: null,
    };
  }

  async ask(input = {}, actor = {}) {
    if (String(input.action || '').toUpperCase() === 'EXECUTE_CHAIN_JOB') return this.executeChainJob(input, actor);

    const question = cleanQuestion(input.question);
    const stateExplanation = explainAdminState(this.domain, question);
    if (stateExplanation) {
      const response = { agent: 'SRA_ADMIN_INTELLIGENCE_AGENT', question, intent: stateExplanation.intent, productCode: null, authorityMode: 'HUMAN_IN_THE_LOOP', actor: { id: actor.id || null, displayName: actor.displayName || null }, answeredAt: new Date().toISOString(), ...stateExplanation };
      if (this.database?.audit) await this.database.audit({ actorId: actor.id || 'SRA_PLATFORM_ADMIN', eventType: 'ADMIN_AGENT_QUESTION_ANSWERED', objectType: 'SRA_ADMIN_INTELLIGENCE_AGENT', objectId: stateExplanation.subject?.reference || stateExplanation.intent, payload: { intent: stateExplanation.intent, status: response.status, referenceCount: response.references?.length || 0, readOnlySimulation: Boolean(response.simulation?.readOnly) } });
      return response;
    }

    const requestedCode = input.productCode ? String(input.productCode).toUpperCase() : null;
    const productCode = requestedCode || detectProduct(this.domain, question);
    const detectedIntent = intent(question, productCode);
    let result;
    if (detectedIntent === 'PRODUCT_LIFECYCLE') result = { ...productAnswer(scanProductLifecycleProgress(this.domain, productCode)), data: scanProductLifecycleProgress(this.domain, productCode) };
    else if (detectedIntent === 'CHAIN_OPERATIONS') result = this.chainOperationsSummary();
    else if (detectedIntent === 'OPERATIONAL_BRIEF') result = this.operationalBrief();
    else if (detectedIntent === 'PLATFORM_SUMMARY') result = this.platformSummary();
    else if (detectedIntent === 'APPROVALS') result = this.approvalSummary();
    else if (detectedIntent === 'CAPABILITIES') result = { answer: 'I can generate an operational brief, discover registered SRA products, read operational records, trace product lifecycles, identify blockers, explain asset exportability and relationships, simulate approval impact, delegate defined work to platform operations agents, and tell you when administrator approval is required. Protected financial and chain state changes remain behind administrator approval.', status: 'AVAILABLE', capabilities: this.capabilities(), blockers: [], references: [], nextAction: null };
    else result = { answer: 'I could not identify the product or operational subject in that question. Name the product or instrument, or ask for an operational brief, platform status, chain operations, blockers, relationships, next actions, or pending approvals.', status: 'NEEDS_CONTEXT', blockers: ['QUESTION_NOT_RESOLVED'], references: [], nextAction: null };

    const response = { agent: 'SRA_ADMIN_INTELLIGENCE_AGENT', question, intent: detectedIntent, productCode, authorityMode: 'HUMAN_IN_THE_LOOP', actor: { id: actor.id || null, displayName: actor.displayName || null }, answeredAt: new Date().toISOString(), ...result };
    if (this.database?.audit) await this.database.audit({ actorId: actor.id || 'SRA_PLATFORM_ADMIN', eventType: 'ADMIN_AGENT_QUESTION_ANSWERED', objectType: 'SRA_ADMIN_INTELLIGENCE_AGENT', objectId: productCode || detectedIntent, payload: { intent: detectedIntent, productCode, status: response.status, referenceCount: response.references?.length || 0 } });
    return response;
  }
}
