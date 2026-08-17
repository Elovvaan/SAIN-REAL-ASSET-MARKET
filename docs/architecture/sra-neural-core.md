# SRA Neural Core

SRA uses a three-level institutional intelligence architecture above the deterministic financial services already present in the platform.

## Governing rule

The neural layer can interpret, classify, summarize, forecast, plan, and prepare work. It is not the ledger, settlement rail, credit authority, or source of transaction finality.

```text
Administrator / institutional intent
        ↓
SRA Neural Core
        ↓
Copilot / Orchestrator / Adaptive Intelligence
        ↓
Policy and authority boundaries
        ↓
Existing governed SRA services
        ↓
Financing / settlement / servicing / marketplace / ledger
```

## Level 1 — Copilot

The existing SAIN Administrative Agent is the Copilot layer. It can read platform state, trace lifecycles, identify blockers, explain records, summarize evidence, and recommend the next action.

Authority: `READ_AND_RECOMMEND`.

Copilot output does not change financial state.

## Level 2 — Orchestrator

The Orchestrator converts an institutional objective into an explicit plan. Each step is classified as one of:

- `READ_ONLY`
- `SAFE_PREPARATION`
- `ADMIN_APPROVAL_REQUIRED`
- `FINANCIAL_AUTHORIZATION`
- `EXTERNAL_SETTLEMENT`

A plan starts as `PROPOSED`. It requires explicit administrator approval before dispatch. Dispatch creates governed handoffs; it does not self-execute financing approval, funding authorization, external settlement, marketplace publication, allocation, or ownership recognition.

Examples:

```text
Objective: Finance this business acquisition
        ↓
CHECK_INTAKE_COMPLETENESS
PREPARE_UNDERWRITING_HANDOFF
PREPARE_DECISION_PACKET
ADMIN DECISION
PREPARE_FUNDING_AUTHORIZATION
ADMIN FUNDING AUTHORIZATION
EXTERNAL SETTLEMENT
SERVICING
```

```text
Objective: Make part of this funded position available
        ↓
ASSESS_FUNDED_POSITION
PREPARE_DISTRIBUTION_AUTHORIZATION
ADMIN DISTRIBUTION AUTHORIZATION
MARKETPLACE LIFECYCLE
```

## Level 3 — Adaptive Institutional Intelligence

Adaptive Institutional Intelligence creates a durable institutional learning layer from SRA's own completed financing outcomes.

The initial production model is a small feed-forward neural network implemented directly in the SRA service layer. Its feature vector intentionally excludes protected personal characteristics and contains only operational / financing-package characteristics:

```text
normalizedRequestedAmount
supportingDocumentDensity
evidenceDensity
agreementDensity
startupBusiness
businessAcquisition
lineOfCredit
preferredFundingDatePresent
```

The initial target is `WORKFLOW_COMPLETION`. This is an operational forecast, not a credit decision.

The model may report a workflow-completion likelihood and discover portfolio patterns, but its `decisionAuthority` is always `ADVISORY_ONLY`.

Explicitly prohibited neural uses:

- automatic credit approval
- automatic credit decline
- automatic funding authorization
- automatic settlement

A model snapshot is promoted only after explicit administrator approval and a minimum historical sample threshold. Previous active snapshots are retained as `SUPERSEDED` for auditability.

## Agent API actions

The existing private administrator agent endpoint accepts neural actions through the same authenticated control surface:

```text
NEURAL_STATUS
CREATE_ORCHESTRATION_PLAN
APPROVE_ORCHESTRATION_PLAN
DISPATCH_ORCHESTRATION_PLAN
LIST_ORCHESTRATION_PLANS
CAPTURE_NEURAL_OUTCOME
TRAIN_ADAPTIVE_MODEL
FORECAST_OPPORTUNITY
INSTITUTIONAL_INSIGHTS
```

This keeps neural control inside the existing private administrative boundary rather than adding an independent application or second financing workflow.

## Non-negotiable invariants

1. Neural output is not ledger truth.
2. Neural output cannot self-approve financing.
3. Neural output cannot self-authorize funding.
4. Neural output cannot self-confirm settlement.
5. Protected personal characteristics are not neural model features.
6. Existing governed SRA services remain authoritative.
7. A settlement reference or other required evidence cannot be invented by the neural layer.
8. Participant demand remains separate from origination; the neural layer does not reintroduce participant funding as a prerequisite to financing.
