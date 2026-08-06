const IMPACTS = Object.freeze({
  RESOLVE_BLOCKERS: {
    effect: 'Review the position, instrument, ownership, or restriction records that prevent the Coin Position from advancing.',
    remainsLocked: ['VALUE_MOVEMENT', 'OWNERSHIP_CHANGE', 'MARKET_PUBLICATION'],
  },
  AUTHORIZE_PUBLICATION: {
    effect: 'Publish the already-ready listing so participants may submit governed order intents.',
    remainsLocked: ['ORDER_MATCHING', 'ALLOCATION', 'SETTLEMENT', 'OWNERSHIP_TRANSFER', 'EXPORT'],
  },
  APPROVE_ALLOCATION: {
    effect: 'Assign the protected SRA quantity to the buyer as pending settlement while both holds remain active.',
    remainsLocked: ['BALANCE_MOVEMENT', 'FINAL_OWNERSHIP', 'EXPORT'],
  },
  AUTHORIZE_SETTLEMENT: {
    effect: 'Atomically exchange the held buyer value and seller SRA quantity, create the buyer position, and recognize ownership.',
    remainsLocked: ['EXTERNAL_TRANSFER', 'EXTERNAL_WITHDRAWAL'],
  },
  REVIEW_EXPORT_ELIGIBILITY: {
    effect: 'Verify the settled position and ownership lineage and, if eligible, prepare a governed export package.',
    remainsLocked: ['EXTERNAL_EXECUTION', 'EXTERNAL_WITHDRAWAL', 'OWNERSHIP_CHANGE'],
  },
  VERIFY_TRANSFER_DESTINATION: {
    effect: 'Verify the participant-owned external destination and prepare a non-executable transfer instruction.',
    remainsLocked: ['EXTERNAL_EXECUTION', 'INTERNAL_POSITION_REDUCTION'],
  },
  AUTHORIZE_EXTERNAL_EXECUTION: {
    effect: 'Authorize an external operator to act on the verified instruction without yet changing internal position or ownership.',
    remainsLocked: ['INTERNAL_POSITION_REDUCTION', 'OWNERSHIP_CHANGE', 'COMPLETION_CLAIM'],
  },
  RECONCILE_EXTERNAL_RESULT: {
    effect: 'Record a verified external result. Completion externalizes quantity and marks ownership externally held; failure preserves the internal position.',
    remainsLocked: ['UNVERIFIED_COMPLETION', 'DUPLICATE_RECONCILIATION'],
  },
  REVIEW_FAILED_EXTERNAL_TRANSFER: {
    effect: 'Inspect the failed external result and determine whether a new governed instruction or corrective action is appropriate.',
    remainsLocked: ['AUTOMATIC_RETRY', 'VALUE_MOVEMENT', 'OWNERSHIP_CHANGE'],
  },
  AVAILABLE_FOR_GOVERNED_MARKET_PARTICIPATION: {
    effect: 'The position may support a participant order intent subject to listing, participant, quantity, and price controls.',
    remainsLocked: ['AUTOMATIC_ORDER', 'AUTOMATIC_MATCH', 'AUTOMATIC_SETTLEMENT'],
  },
  APPLY_OR_REVIEW_MARKET_READINESS_POLICY: {
    effect: 'Evaluate the linked instrument and listing against the standing SRA/USD readiness policy.',
    remainsLocked: ['PUBLICATION', 'ORDER_EXECUTION', 'SETTLEMENT'],
  },
  MONITOR_EXTERNAL_HOLDING: {
    effect: 'Continue servicing and reporting the externally held position without creating another transfer.',
    remainsLocked: ['DUPLICATE_EXPORT', 'DUPLICATE_TRANSFER'],
  },
  INSPECT_POSITION: {
    effect: 'Inspect the Coin Position and its linked records. No state change is proposed.',
    remainsLocked: ['ALL_STATE_CHANGES'],
  },
});

export class SraCoinAgentInspectionService {
  constructor(coinAgentService) { this.coinAgentService = coinAgentService; }

  inspect(positionId) {
    const agent = this.coinAgentService.explain(positionId);
    const impact = IMPACTS[agent.nextEligibleAction] || IMPACTS.INSPECT_POSITION;
    return {
      agent,
      actionImpact: {
        action: agent.nextEligibleAction,
        readOnly: true,
        effect: impact.effect,
        remainsLocked: impact.remainsLocked,
        humanApprovalRequired: agent.humanApprovalRequired,
        canAgentExecute: false,
      },
    };
  }

  list(input = {}) {
    return {
      agents: this.coinAgentService.list(input),
      status: this.coinAgentService.status(),
    };
  }
}
