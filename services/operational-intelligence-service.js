import crypto from 'node:crypto';

const TYPES = Object.freeze({
  EVENT: 'OPERATIONAL_EVENT',
  MEMORY: 'OPERATIONAL_MEMORY',
  DECISION: 'AGENT_DECISION',
  PLAN: 'ACTION_PLAN',
  RESULT: 'ACTION_RESULT',
  OUTCOME: 'OUTCOME_EVALUATION',
});

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function compact(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export class OperationalIntelligenceService {
  constructor(domain) {
    if (!domain) throw new Error('Operational intelligence requires the SRA domain store.');
    this.domain = domain;
  }

  persist(type, record) {
    if (typeof this.domain.create === 'function') return this.domain.create(type, record);
    if (typeof this.domain.put === 'function') return this.domain.put(type, record);
    if (typeof this.domain.set === 'function') return this.domain.set(type, record.id, record);
    throw new Error('SRA domain store does not expose a supported persistence method.');
  }

  records(type) {
    return typeof this.domain.list === 'function' ? this.domain.list(type) : [];
  }

  observe(input = {}) {
    if (!input.eventType) throw new Error('eventType is required.');
    const eventId = input.eventId || id('OE');
    const record = compact({
      id: eventId,
      eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt || now(),
      source: input.source || 'SRA',
      actorType: input.actorType || null,
      actorId: input.actorId || null,
      transactionId: input.transactionId || null,
      participantId: input.participantId || null,
      assetId: input.assetId || null,
      instrumentId: input.instrumentId || null,
      financingTransactionId: input.financingTransactionId || null,
      workOrderId: input.workOrderId || null,
      listingId: input.listingId || null,
      settlementId: input.settlementId || null,
      exportPackageId: input.exportPackageId || null,
      stateBefore: input.stateBefore || null,
      stateAfter: input.stateAfter || null,
      payload: input.payload || {},
      correlationId: input.correlationId || input.financingTransactionId || input.transactionId || eventId,
    });
    this.persist(TYPES.EVENT, record);
    return record;
  }

  remember(input = {}) {
    if (!input.subjectType || !input.subjectId) throw new Error('subjectType and subjectId are required.');
    const memoryId = input.memoryId || id('OM');
    const record = compact({
      id: memoryId,
      memoryId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      memoryType: input.memoryType || 'OPERATIONAL_FACT',
      summary: input.summary || null,
      facts: input.facts || {},
      sourceEventId: input.sourceEventId || null,
      transactionId: input.transactionId || null,
      confidence: input.confidence ?? 1,
      status: input.status || 'ACTIVE',
      recordedAt: input.recordedAt || now(),
    });
    this.persist(TYPES.MEMORY, record);
    return record;
  }

  recordDecision(input = {}) {
    if (!input.agentId || !input.decision) throw new Error('agentId and decision are required.');
    const decisionId = input.decisionId || id('AD');
    const record = compact({
      id: decisionId,
      decisionId,
      agentId: input.agentId,
      decision: input.decision,
      reason: input.reason || null,
      evidence: input.evidence || [],
      transactionId: input.transactionId || null,
      workOrderId: input.workOrderId || null,
      sourceEventIds: input.sourceEventIds || [],
      authorityRequired: input.authorityRequired ?? false,
      authorityStatus: input.authorityStatus || (input.authorityRequired ? 'PENDING' : 'NOT_REQUIRED'),
      decidedAt: input.decidedAt || now(),
    });
    this.persist(TYPES.DECISION, record);
    return record;
  }

  createPlan(input = {}) {
    if (!input.goal) throw new Error('goal is required.');
    const planId = input.planId || id('AP');
    const record = compact({
      id: planId,
      planId,
      goal: input.goal,
      transactionId: input.transactionId || null,
      createdByAgentId: input.createdByAgentId || null,
      sourceDecisionId: input.sourceDecisionId || null,
      steps: input.steps || [],
      dependencies: input.dependencies || [],
      status: input.status || 'PLANNED',
      createdAt: input.createdAt || now(),
    });
    this.persist(TYPES.PLAN, record);
    return record;
  }

  recordResult(input = {}) {
    if (!input.action) throw new Error('action is required.');
    const resultId = input.resultId || id('AR');
    const record = compact({
      id: resultId,
      resultId,
      action: input.action,
      planId: input.planId || null,
      planStepId: input.planStepId || null,
      agentId: input.agentId || null,
      transactionId: input.transactionId || null,
      status: input.status || 'RECORDED',
      externalReference: input.externalReference || null,
      data: input.data || {},
      error: input.error || null,
      completedAt: input.completedAt || now(),
    });
    this.persist(TYPES.RESULT, record);
    return record;
  }

  evaluateOutcome(input = {}) {
    if (!input.target || !input.status) throw new Error('target and status are required.');
    const outcomeId = input.outcomeId || id('OX');
    const record = compact({
      id: outcomeId,
      outcomeId,
      target: input.target,
      status: input.status,
      transactionId: input.transactionId || null,
      resultId: input.resultId || null,
      expected: input.expected || null,
      observed: input.observed || null,
      evidence: input.evidence || [],
      notes: input.notes || null,
      evaluatedByAgentId: input.evaluatedByAgentId || null,
      evaluatedAt: input.evaluatedAt || now(),
    });
    this.persist(TYPES.OUTCOME, record);
    return record;
  }

  contextFor(subjectId) {
    if (!subjectId) throw new Error('subjectId is required.');
    const belongs = (record) => [
      record.subjectId,
      record.transactionId,
      record.financingTransactionId,
      record.participantId,
      record.assetId,
      record.instrumentId,
      record.workOrderId,
      record.listingId,
      record.settlementId,
      record.exportPackageId,
    ].includes(subjectId);
    return {
      subjectId,
      events: this.records(TYPES.EVENT).filter(belongs),
      memories: this.records(TYPES.MEMORY).filter(belongs),
      decisions: this.records(TYPES.DECISION).filter(belongs),
      plans: this.records(TYPES.PLAN).filter(belongs),
      results: this.records(TYPES.RESULT).filter(belongs),
      outcomes: this.records(TYPES.OUTCOME).filter(belongs),
    };
  }
}

export { TYPES as OperationalIntelligenceRecordTypes };
