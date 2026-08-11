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

function now() {
  return new Date().toISOString();
}

export function normalizeFinancingStage(record = {}) {
  const explicit = String(record.financingStage || '').toUpperCase();

  // Migrate removed authoritative stages forward
  if (explicit === 'DOCUMENTATION' || explicit === 'VERIFICATION') {
    return 'UNDERWRITING';
  }

  // If it's a current valid stage, return it
  if (FINANCING_STAGES.includes(explicit)) return explicit;

  // Fall back to legacy status field
  return LEGACY_STAGE_MAP[
    String(record.status || '').toUpperCase()
  ] || 'APPLICATION';
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

    if (FINANCING_STAGES.includes(current.financingStage)) {
      return current;
    }

    const financingStage = normalizeFinancingStage(current);

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
    const target = String(toStage || '').toUpperCase();

    if (!FINANCING_STAGES.includes(target)) {
      throw new Error(
        `Unsupported financing stage: ${target}`
      );
    }

    const current = await this.ensure(
      opportunityId,
      actorId
    );

    const from = normalizeFinancingStage(current);

    if (from === target) {
      return current;
    }

    if (!TRANSITIONS[from]?.has(target)) {
      throw new Error(
        `Financing lifecycle cannot advance from ${from} to ${target}.`
      );
    }

    const occurredAt = now();

    const updated = {
      ...current,
      financingStage: target,
      updatedAt: occurredAt,
      financingStageUpdatedAt: occurredAt,
      financingStageUpdatedBy: actorId,
      financingHistory: [
        ...(current.financingHistory || []),
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
    };

    await this.domain.put(
      OPPORTUNITY_TYPE,
      opportunityId,
      updated,
      {
        actorId,
        eventType: `FINANCING_STAGE_${target}`,
      }
    );

    await this.domain.lifecycle({
      objectType: OPPORTUNITY_TYPE,
      objectId: opportunityId,
      eventType: 'FINANCING_STAGE_CHANGED',
      actorId,
      payload: {
        from,
        to: target,
        reason: input.reason || null,
        source: input.source || null,
        referenceId: input.referenceId || null,
      },
    });

    return updated;
  }
}
