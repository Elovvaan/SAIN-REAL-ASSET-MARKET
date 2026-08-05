const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  EVIDENCE: 'FUNDING_OPPORTUNITY_EVIDENCE',
  VERIFICATION_REQUEST: 'FUNDING_OPPORTUNITY_VERIFICATION_REQUEST',
  VERIFICATION_FINDING: 'FUNDING_OPPORTUNITY_VERIFICATION_FINDING',
  VALUE_PREPARATION: 'FUNDING_OPPORTUNITY_VALUE_PREPARATION',
  MODEL_SELECTION: 'FUNDING_MODEL_SELECTION',
  INSTRUMENT: 'SRA_INSTRUMENT',
  INSTRUMENT_REVIEW: 'FUNDING_INSTRUMENT_DRAFT_REVIEW',
  ISSUANCE_REQUEST: 'FUNDING_INSTRUMENT_ISSUANCE_REQUEST',
  LISTING: 'MARKETPLACE_LISTING',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  POSITION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT_PREPARATION: 'FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION',
});

const WORKFLOW = Object.freeze([
  ['INTAKE', ['INTAKE_IN_PROGRESS', 'INTAKE_COMPLETE', 'PENDING_VERIFICATION']],
  ['VERIFICATION', ['VERIFICATION_IN_PROGRESS', 'MORE_EVIDENCE_REQUIRED']],
  ['VALUE_PREPARATION', ['VERIFIED']],
  ['MODEL_SELECTION', ['VALUE_PREPARED']],
  ['INSTRUMENT_SELECTION', ['FUNDING_MODEL_SELECTED']],
  ['INSTRUMENT_REVIEW', ['INSTRUMENT_DRAFTED']],
  ['ISSUANCE', ['INSTRUMENT_REVIEWED', 'ISSUANCE_REQUESTED']],
  ['MARKETPLACE_PREPARATION', ['INSTRUMENT_ISSUED']],
  ['PUBLICATION', ['MARKETPLACE_LISTING_PREPARED']],
  ['COMMITMENTS', ['MARKETPLACE_LIVE']],
  ['ALLOCATION', ['ALLOCATION_CREATED']],
  ['SETTLEMENT', ['POSITION_SETTLED']],
]);

function now() {
  return new Date().toISOString();
}

function ageHours(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 3_600_000) : null;
}

function groupBy(records, selector) {
  return records.reduce((acc, record) => {
    const key = selector(record) || 'UNKNOWN';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function recordTime(record) {
  return record.updatedAt || record.createdAt || record.startedAt || record.requestedAt || record.recordedAt || null;
}

export class SainOperationsIntelligenceService {
  constructor(domain) {
    this.domain = domain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SAIN Operations Intelligence',
      purpose: 'INTERNAL_PLATFORM_AWARENESS_AND_OPERATIONAL_GUIDANCE',
      available: true,
      generatedAt: now(),
    };
  }

  registry() {
    return {
      generatedAt: now(),
      recordTypes: Object.entries(TYPES).map(([name, recordType]) => ({ name, recordType, count: this.domain.list(recordType).length })),
      workflow: WORKFLOW.map(([queue, statuses], index) => ({ phaseNumber: index + 1, queue, statuses })),
      capabilities: [
        'PLATFORM_SUMMARY',
        'HEALTH_ASSESSMENT',
        'BOTTLENECK_DETECTION',
        'RECOMMENDATIONS',
        'OPPORTUNITY_EXPLANATION',
        'WORK_QUEUE_SUMMARY',
      ],
    };
  }

  metrics() {
    const opportunities = this.domain.list(TYPES.OPPORTUNITY);
    const listings = this.domain.list(TYPES.LISTING);
    const commitments = this.domain.list(TYPES.COMMITMENT);
    const positions = this.domain.list(TYPES.POSITION);
    const instruments = this.domain.list(TYPES.INSTRUMENT);
    return {
      generatedAt: now(),
      opportunities: {
        total: opportunities.length,
        statusCounts: groupBy(opportunities, (record) => record.status),
        requestedAmount: opportunities.reduce((sum, record) => sum + Number(record.requestedAmount || 0), 0),
      },
      instruments: {
        total: instruments.length,
        draft: instruments.filter((record) => record.state === 'DRAFT').length,
        issued: instruments.filter((record) => record.issuanceStatus === 'ISSUED').length,
      },
      marketplace: {
        listings: listings.length,
        liveListings: listings.filter((record) => record.state === 'LIVE' && record.publicationStatus === 'PUBLISHED').length,
        commitments: commitments.length,
        confirmedCommitments: commitments.filter((record) => record.status === 'CONFIRMED').length,
      },
      positions: {
        total: positions.length,
        pendingSettlement: positions.filter((record) => record.ownershipStatus === 'PENDING_SETTLEMENT').length,
        recognized: positions.filter((record) => record.ownershipStatus === 'RECOGNIZED').length,
      },
    };
  }

  bottlenecks() {
    const opportunities = this.domain.list(TYPES.OPPORTUNITY);
    const queues = WORKFLOW.map(([queue, statuses]) => {
      const records = opportunities.filter((record) => statuses.includes(record.status));
      const ages = records.map((record) => ageHours(recordTime(record))).filter((value) => value != null);
      return {
        queue,
        count: records.length,
        oldestAgeHours: ages.length ? Math.round(Math.max(...ages) * 10) / 10 : 0,
        opportunityIds: records.slice(0, 10).map((record) => record.opportunityId),
      };
    }).filter((item) => item.count > 0);

    const ranked = queues.sort((a, b) => (b.count * 10 + b.oldestAgeHours) - (a.count * 10 + a.oldestAgeHours));
    return {
      generatedAt: now(),
      primary: ranked[0] || null,
      queues: ranked,
    };
  }

  health() {
    const metrics = this.metrics();
    const bottlenecks = this.bottlenecks();
    const stale = bottlenecks.queues.filter((item) => item.oldestAgeHours >= 72);
    const backlog = bottlenecks.queues.filter((item) => item.count >= 10);
    let score = 100;
    score -= Math.min(35, stale.length * 10);
    score -= Math.min(35, backlog.reduce((sum, item) => sum + Math.min(10, item.count - 9), 0));
    score -= Math.min(20, metrics.positions.pendingSettlement * 2);
    score = Math.max(0, score);
    const status = score >= 85 ? 'HEALTHY' : score >= 65 ? 'WATCH' : 'ATTENTION_REQUIRED';
    return {
      generatedAt: now(),
      status,
      score,
      indicators: {
        staleQueues: stale,
        highBacklogQueues: backlog,
        pendingSettlementPositions: metrics.positions.pendingSettlement,
        liveListings: metrics.marketplace.liveListings,
      },
    };
  }

  recommendations() {
    const bottlenecks = this.bottlenecks();
    const metrics = this.metrics();
    const items = [];
    for (const queue of bottlenecks.queues.slice(0, 5)) {
      if (queue.count >= 5) items.push({ priority: 'HIGH', queue: queue.queue, recommendation: `Work the ${queue.queue.toLowerCase().replaceAll('_', ' ')} queue; ${queue.count} opportunities are waiting.`, opportunityIds: queue.opportunityIds });
      else if (queue.oldestAgeHours >= 48) items.push({ priority: 'MEDIUM', queue: queue.queue, recommendation: `Review the oldest ${queue.queue.toLowerCase().replaceAll('_', ' ')} item; it has waited about ${Math.round(queue.oldestAgeHours)} hours.`, opportunityIds: queue.opportunityIds.slice(0, 3) });
    }
    if (metrics.positions.pendingSettlement > 0) items.push({ priority: 'HIGH', queue: 'SETTLEMENT', recommendation: `${metrics.positions.pendingSettlement} positions are pending settlement.`, opportunityIds: [] });
    if (metrics.marketplace.liveListings === 0 && metrics.instruments.issued > 0) items.push({ priority: 'MEDIUM', queue: 'MARKETPLACE_PREPARATION', recommendation: 'Issued instruments exist, but no marketplace listing is live.', opportunityIds: [] });
    if (!items.length) items.push({ priority: 'LOW', queue: 'GENERAL', recommendation: 'No material operational bottleneck is currently detected.', opportunityIds: [] });
    return { generatedAt: now(), records: items };
  }

  explainOpportunity(opportunityId) {
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, opportunityId);
    if (!opportunity) return null;
    const evidence = this.domain.list(TYPES.EVIDENCE).filter((record) => record.opportunityId === opportunityId);
    const verificationRequests = this.domain.list(TYPES.VERIFICATION_REQUEST).filter((record) => record.opportunityId === opportunityId);
    const latestRequest = verificationRequests[verificationRequests.length - 1] || null;
    const findings = latestRequest ? this.domain.list(TYPES.VERIFICATION_FINDING).filter((record) => record.verificationRequestId === latestRequest.verificationRequestId) : [];
    const queue = WORKFLOW.find(([, statuses]) => statuses.includes(opportunity.status))?.[0] || 'COMPLETED_OR_GENERAL_REVIEW';
    const blocking = [];
    if (opportunity.status === 'MORE_EVIDENCE_REQUIRED') blocking.push('Additional evidence is required before verification can continue.');
    if (opportunity.status === 'VERIFICATION_IN_PROGRESS' && latestRequest) {
      const covered = new Set(findings.map((record) => record.checkType));
      const missing = (latestRequest.requestedChecks || []).filter((check) => !covered.has(check));
      if (missing.length) blocking.push(`Missing verification findings: ${missing.join(', ')}.`);
      if (findings.some((record) => ['CONFLICT', 'UNVERIFIED'].includes(record.result))) blocking.push('A blocking verification finding remains unresolved.');
    }
    return {
      opportunityId,
      title: opportunity.title,
      status: opportunity.status,
      fundingPhase: opportunity.fundingPhase,
      responsibleQueue: queue,
      ageHours: ageHours(recordTime(opportunity)),
      evidenceCount: evidence.length,
      latestVerificationRequest: latestRequest,
      blockers: blocking,
      nextAction: this.nextAction(opportunity),
    };
  }

  nextAction(opportunity) {
    const map = {
      INTAKE_IN_PROGRESS: 'Complete required intake fields and references.',
      INTAKE_COMPLETE: 'Create the verification request.',
      PENDING_VERIFICATION: 'Create or start the verification request.',
      VERIFICATION_IN_PROGRESS: 'Record all requested verification findings.',
      MORE_EVIDENCE_REQUIRED: 'Register the requested supporting evidence.',
      VERIFIED: 'Create the Verified Value preparation record.',
      VALUE_PREPARED: 'Select the funding model.',
      FUNDING_MODEL_SELECTED: 'Create the instrument-selection request.',
      INSTRUMENT_DRAFTED: 'Complete draft instrument review.',
      INSTRUMENT_REVIEWED: 'Create the issuance request.',
      ISSUANCE_REQUESTED: 'Complete issuance review and authorization.',
      INSTRUMENT_ISSUED: 'Prepare the marketplace listing.',
      MARKETPLACE_LISTING_PREPARED: 'Complete publication review.',
      MARKETPLACE_LIVE: 'Open or manage commitments.',
      ALLOCATION_CREATED: 'Prepare settlement.',
      POSITION_SETTLED: 'Monitor the recognized position lifecycle.',
    };
    return map[opportunity.status] || 'Review the opportunity record and lifecycle history.';
  }

  summary() {
    const metrics = this.metrics();
    const health = this.health();
    const bottlenecks = this.bottlenecks();
    const recommendations = this.recommendations();
    return { generatedAt: now(), health, metrics, bottlenecks, recommendations: recommendations.records };
  }

  ask(question) {
    const text = String(question || '').trim();
    const normalized = text.toLowerCase();
    const idMatch = text.match(/[A-Z]{2,10}-[A-Z0-9-]{4,}/);
    if (idMatch) {
      const explanation = this.explainOpportunity(idMatch[0]);
      if (explanation) return { question: text, intent: 'OPPORTUNITY_EXPLANATION', answer: explanation };
    }
    if (normalized.includes('bottleneck') || normalized.includes('stuck') || normalized.includes('slowing')) return { question: text, intent: 'BOTTLENECKS', answer: this.bottlenecks() };
    if (normalized.includes('health') || normalized.includes('healthy')) return { question: text, intent: 'HEALTH', answer: this.health() };
    if (normalized.includes('recommend') || normalized.includes('attention') || normalized.includes('what should')) return { question: text, intent: 'RECOMMENDATIONS', answer: this.recommendations() };
    if (normalized.includes('how many') || normalized.includes('count') || normalized.includes('metrics')) return { question: text, intent: 'METRICS', answer: this.metrics() };
    return { question: text, intent: 'SUMMARY', answer: this.summary() };
  }
}

export { TYPES as SAIN_OPERATIONS_INTELLIGENCE_RECORD_TYPES };
