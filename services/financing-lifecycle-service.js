const OPPORTUNITY_TYPE = 'FUNDING_OPPORTUNITY';

export const FINANCING_STAGES = Object.freeze([
  'APPLICATION',
  'UNDERWRITING',
  'DECISION',
  'CLOSING',
  'READY_TO_FUND',
  'FUNDED',
  'SERVICING',
  'CLOSED',
]);

const TRANSITIONS = Object.freeze({
  APPLICATION: new Set(['UNDERWRITING', 'CLOSED']),
  UNDERWRITING: new Set(['DECISION', 'CLOSED']),
  DECISION: new Set(['CLOSING', 'CLOSED']),
  CLOSING: new Set(['READY_TO_FUND', 'CLOSED']),
  READY_TO_FUND: new Set(['FUNDED', 'CLOSED']),
  FUNDED: new Set(['SERVICING', 'CLOSED']),
  SERVICING: new Set(['CLOSED']),
  CLOSED: new Set(),
});

const LEGACY_STAGE_MAP = Object.freeze({
  DRAFT: 'APPLICATION',
  INTAKE_IN_PROGRESS: 'APPLICATION',
  INTAKE_COMPLETE: 'UNDERWRITING',
  PENDING_VERIFICATION: 'UNDERWRITING',
  VERIFICATION_IN_PROGRESS: 'UNDERWRITING',
  MORE_EVIDENCE_REQUIRED: 'UNDERWRITING',
  VERIFIED: 'UNDERWRITING',
  VALUE_PREPARED: 'UNDERWRITING',
  FUNDING_MODEL_SELECTED: 'UNDERWRITING',
  INSTRUMENT_REVIEWED: 'UNDERWRITING',
  ISSUANCE_REQUESTED: 'DECISION',
  APPROVED: 'CLOSING',
  READY_TO_FUND: 'READY_TO_FUND',
  FUNDED: 'FUNDED',
  ACTIVE: 'SERVICING',
  PAID_OFF: 'CLOSED',
  CLOSED: 'CLOSED',
  WITHDRAWN: 'CLOSED',
  VERIFICATION_CLOSED: 'CLOSED',
  REJECTED: 'CLOSED',
});

const TERMINAL_LEGACY_STATUSES = new Set(['WITHDRAWN', 'CLOSED', 'PAID_OFF', 'VERIFICATION_CLOSED', 'REJECTED']);

function now() {
  return new Date().toISOString();
}

export function normalizeFinancingStage(record = {}) {
  const legacyStatus = String(record.status || '').toUpperCase();
  if (TERMINAL_LEGACY_STATUSES.has(legacyStatus)) return 'CLOSED';

  const explicit = String(record.financingStage || '').toUpperCase();
  if (explicit === 'DOCUMENTATION' || explicit === 'VERIFICATION') return 'UNDERWRITING';
  if (FINANCING_STAGES.includes(explicit)) return explicit;

  return LEGACY_STAGE_MAP[legacyStatus] || 'APPLICATION';
}

export function prepareFinancingTransition(record, toStage, input = {}, actorId = null, occurredAt = now()) {
  if (!record) throw new Error('Funding opportunity was not found.');
  const target = String(toStage || '').toUpperCase();
  if (!FINANCING_STAGES.includes(target)) throw new Error(`Unsupported financing stage: ${target}`);
  const from = normalizeFinancingStage(record);
  if (from === target) return { opportunity: record, from, to: target, changed: false };
  if (!TRANSITIONS[from]?.has(target)) throw new Error(`Financing lifecycle cannot advance from ${from} to ${target}.`);

  return {
    from,
    to: target,
    changed: true,
    opportunity: {
      ...record,
      financingStage: target,
      updatedAt: occurredAt,
      financingStageUpdatedAt: occurredAt,
      financingStageUpdatedBy: actorId,
      financingHistory: [
        ...(record.financingHistory || []),
        {
          from,
          to: target,
          at: occurredAt,
          actorId,
          reason: input.reason || null,
          source: input.source || null,
          referenceId: input.referenceId || null,
        },
      ],
    },
  };
}

export class FinancingLifecycleService {
  constructor(domain) {
    this.domain = domain;
  }

  get(opportunityId) {
    return this.domain.get(OPPORTUNITY_TYPE, opportunityId);
  }

  async ensure(opportunityId, actorId = null) {
    const current = this.get(opportunityId);

    if (!current) {
      throw new Error('Funding opportunity was not found.');
    }

    const financingStage = normalizeFinancingStage(current);
    if (current.financingStage === financingStage) return current;

    const updated = {
      ...current,
      financingStage,
      updatedAt: now(),
    };

    await this.domain.put(
      OPPORTUNITY_TYPE,
      opportunityId,
      updated,
      {
        actorId,
        eventType: 'FINANCING_LIFECYCLE_NORMALIZED',
      }
    );

    return updated;
  }

  async transition(
    opportunityId,
    toStage,
    input = {},
    actorId = null
  ) {
    const current = await this.ensure(opportunityId, actorId);
    const prepared = prepareFinancingTransition(current, toStage, input, actorId);
    if (!prepared.changed) return current;

    await this.domain.put(
      OPPORTUNITY_TYPE,
      opportunityId,
      prepared.opportunity,
      {
        actorId,
        eventType: `FINANCING_STAGE_${prepared.to}`,
      }
    );

    await this.domain.lifecycle({
      objectType: OPPORTUNITY_TYPE,
      objectId: opportunityId,
      eventType: 'FINANCING_STAGE_CHANGED',
      actorId,
      payload: {
        from: prepared.from,
        to: prepared.to,
        reason: input.reason || null,
        source: input.source || null,
        referenceId: input.referenceId || null,
      },
    });

    return prepared.opportunity;
  }
}
