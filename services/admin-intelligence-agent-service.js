import { scanProductLifecycleProgress } from './product-lifecycle-progress-service.js';

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
});

const PROTECTED_STAGES = new Set(['instrument', 'listing', 'allocation', 'settlement', 'ownershipRecognition', 'exportPackage']);

function cleanQuestion(value) {
  const question = String(value || '').trim();
  if (!question) throw new Error('question is required.');
  if (question.length > 2000) throw new Error('question exceeds the 2000 character limit.');
  return question;
}

function detectProduct(question) {
  const upper = question.toUpperCase().replace(/[_-]+/g, ' ');
  for (const [label, code] of Object.entries(PRODUCT_ALIASES)) {
    if (upper.includes(label.replace(/[_-]+/g, ' '))) return code;
  }
  return null;
}

function intent(question, productCode) {
  const normalized = question.toLowerCase();
  if (productCode && /(where|status|stage|progress|far|ready|block|missing|next|why)/.test(normalized)) return 'PRODUCT_LIFECYCLE';
  if (/(what.*need.*approval|approval|approve|human.*loop|my action)/.test(normalized)) return 'APPROVALS';
  if (/(platform|system).*(status|health|doing|summary)|how.*platform/.test(normalized)) return 'PLATFORM_SUMMARY';
  if (/(what can you|help|capabilit|who are you)/.test(normalized)) return 'CAPABILITIES';
  return productCode ? 'PRODUCT_LIFECYCLE' : 'UNKNOWN';
}

function nextActionFor(chain) {
  if (!chain) return null;
  if (!chain.firstMissing) return {
    stage: null,
    label: 'No internal lifecycle stage is missing.',
    authority: 'NONE',
    autonomous: true,
  };
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
      answer: `SRA does not currently contain a ${progress.productCode} instrument. The lifecycle has not started for this product.`,
      status: 'NOT_STARTED',
      blockers: ['NO_INSTRUMENT'],
      nextAction: {
        stage: 'instrument',
        label: `Create and approve the first ${progress.productCode} instrument from a recognized financial record.`,
        authority: 'ADMIN_APPROVAL_REQUIRED',
        autonomous: false,
      },
      references: [],
    };
  }

  const lead = progress.chains[0];
  const completed = lead.completedStages.map((stage) => STAGE_LABELS[stage] || stage);
  const missing = lead.firstMissing;
  const stageText = missing
    ? `It has completed ${completed.join(', ')}. The first missing stage is ${STAGE_LABELS[missing] || missing}.`
    : 'It has completed every internal lifecycle stage and is ready for export.';
  return {
    answer: `SRA found ${progress.instrumentCount} ${progress.productCode} instrument${progress.instrumentCount === 1 ? '' : 's'}. The furthest chain is ${lead.instrumentId}. ${stageText}`,
    status: lead.readyForExport ? 'READY_FOR_EXPORT' : 'IN_PROGRESS',
    blockers: missing ? [`MISSING_${String(missing).replace(/([A-Z])/g, '_$1').toUpperCase()}`] : [],
    nextAction: nextActionFor(lead),
    references: Object.entries(lead.stages)
      .filter(([, stage]) => stage?.id)
      .map(([stage, record]) => ({ stage, recordId: record.id, state: record.state })),
  };
}

export class AdminIntelligenceAgentService {
  constructor({ domain, database = null, productQualification = null }) {
    this.domain = domain;
    this.database = database;
    this.productQualification = productQualification;
  }

  capabilities() {
    return {
      agent: 'SRA_ADMIN_INTELLIGENCE_AGENT',
      mode: 'AUTONOMOUS_READ_AND_REASON',
      writeAuthority: 'HUMAN_IN_THE_LOOP',
      can: [
        'ANSWER_PLATFORM_STATUS',
        'TRACE_PRODUCT_LIFECYCLES',
        'IDENTIFY_BLOCKERS',
        'RECOMMEND_NEXT_ACTION',
        'IDENTIFY_APPROVAL_BOUNDARIES',
        'CITE_INTERNAL_RECORDS',
      ],
      cannotWithoutApproval: [
        'ISSUE_INSTRUMENT',
        'PUBLISH_LISTING',
        'ALLOCATE_POSITION',
        'CONFIRM_SETTLEMENT',
        'RECOGNIZE_OWNERSHIP',
        'CREATE_EXPORT_PACKAGE',
      ],
    };
  }

  platformSummary() {
    const snapshot = this.domain.snapshot();
    const counts = snapshot?.counts || {};
    const lifecycleTypes = [
      'MARKET_OBSERVATION', 'RECOGNITION_ASSESSMENT', 'FINANCIAL_RECORD', 'COIN_POSITION',
      'SRA_INSTRUMENT', 'MARKETPLACE_LISTING', 'PARTICIPATION_POSITION',
      'FUNDING_MARKETPLACE_COMMITMENT', 'FUNDING_MARKETPLACE_POSITION',
      'SRA_SETTLEMENT_RECORD', 'OWNERSHIP_RECOGNITION', 'EXPORT_PACKAGE',
    ];
    const selected = Object.fromEntries(lifecycleTypes.map((type) => [type, counts[type] || 0]));
    const total = Object.values(selected).reduce((sum, value) => sum + Number(value || 0), 0);
    return {
      answer: `SRA is reading ${total} records across the internal asset lifecycle. It currently has ${selected.SRA_INSTRUMENT} instruments, ${selected.MARKETPLACE_LISTING} marketplace listings, ${selected.SRA_SETTLEMENT_RECORD} settlement records, ${selected.OWNERSHIP_RECOGNITION} ownership recognitions, and ${selected.EXPORT_PACKAGE} export-ready packages.`,
      status: 'AVAILABLE',
      counts: selected,
      nextAction: null,
      blockers: [],
      references: [],
    };
  }

  approvalSummary() {
    const products = Object.values(PRODUCT_ALIASES).filter((value, index, array) => array.indexOf(value) === index);
    const pending = [];
    for (const productCode of products) {
      const progress = scanProductLifecycleProgress(this.domain, productCode);
      const lead = progress.chains[0];
      const action = nextActionFor(lead);
      if (action?.authority === 'ADMIN_APPROVAL_REQUIRED') {
        pending.push({ productCode, instrumentId: lead.instrumentId, ...action });
      }
    }
    return {
      answer: pending.length
        ? `SRA identified ${pending.length} lifecycle action${pending.length === 1 ? '' : 's'} at a human approval boundary.`
        : 'SRA did not identify a currently reachable lifecycle action requiring administrator approval.',
      status: pending.length ? 'APPROVAL_REQUIRED' : 'NO_PENDING_APPROVAL',
      pendingActions: pending,
      blockers: [],
      references: pending.filter((item) => item.instrumentId).map((item) => ({ stage: item.stage, recordId: item.instrumentId, state: null })),
      nextAction: pending[0] || null,
    };
  }

  async ask(input = {}, actor = {}) {
    const question = cleanQuestion(input.question);
    const productCode = input.productCode ? String(input.productCode).toUpperCase() : detectProduct(question);
    const detectedIntent = intent(question, productCode);
    let result;

    if (detectedIntent === 'PRODUCT_LIFECYCLE') {
      const progress = scanProductLifecycleProgress(this.domain, productCode);
      result = { ...productAnswer(progress), data: progress };
    } else if (detectedIntent === 'PLATFORM_SUMMARY') {
      result = this.platformSummary();
    } else if (detectedIntent === 'APPROVALS') {
      result = this.approvalSummary();
    } else if (detectedIntent === 'CAPABILITIES') {
      result = {
        answer: 'I can read SRA operational records, trace product lifecycles, identify blockers, explain the next action, and tell you when administrator approval is required. I do not perform protected financial state changes without approval.',
        status: 'AVAILABLE',
        capabilities: this.capabilities(),
        blockers: [],
        references: [],
        nextAction: null,
      };
    } else {
      result = {
        answer: 'I could not identify the product or operational subject in that question. Name the product or ask for platform status, blockers, next actions, or pending approvals.',
        status: 'NEEDS_CONTEXT',
        blockers: ['QUESTION_NOT_RESOLVED'],
        references: [],
        nextAction: null,
      };
    }

    const response = {
      agent: 'SRA_ADMIN_INTELLIGENCE_AGENT',
      question,
      intent: detectedIntent,
      productCode,
      authorityMode: 'HUMAN_IN_THE_LOOP',
      actor: { id: actor.id || null, displayName: actor.displayName || null },
      answeredAt: new Date().toISOString(),
      ...result,
    };

    if (this.database?.audit) {
      await this.database.audit({
        actorId: actor.id || 'SRA_PLATFORM_ADMIN',
        eventType: 'ADMIN_AGENT_QUESTION_ANSWERED',
        objectType: 'SRA_ADMIN_INTELLIGENCE_AGENT',
        objectId: productCode || detectedIntent,
        payload: { intent: detectedIntent, productCode, status: response.status, referenceCount: response.references?.length || 0 },
      });
    }
    return response;
  }
}
