# Platinum Phase 3 — Governed Action Execution

## Purpose

Phase 3 turns a persisted Phase 2 `ACTION_PLAN` into attributable, idempotent execution results without replacing the existing SRA financing, settlement, document, servicing, Agent OS, or authority services.

The operational intelligence chain is now:

```text
OperationalEvent
-> OperationalMemory
-> AgentDecision
-> ActionPlan
-> Governed Action Execution
-> ActionResult
-> OutcomeEvaluation
```

`ACTION_RESULT` records what SRA actually did. It does not claim that an outside party received, accepted, settled, reconciled, or otherwise completed the intended external outcome. External verification remains an `OUTCOME_EVALUATION` concern.

## Execution classes

Phase 3 classifies each plan step before execution.

### SAFE_PREPARATION

The agent may execute preparation work through existing SRA services. Current Phase 2 actions include:

- `INCLUDE_DOCUMENT`
- `INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS`
- `FLAG_DO_NOT_INFER`
- `LEAVE_BLANK_AND_FLAG`

For the financing-disbursement path, `INCLUDE_DOCUMENT` reuses the existing `AchSettlementPacketService` generators for:

- Funding / Settlement package
- Dealer Processing Instructions
- Servicing & Payment Instructions

### PROTECTED

Reserved authority is not executed autonomously. Protected actions are persisted as `ACTION_RESULT.status = AWAITING_AUTHORITY` and include the authority reason.

Protected actions include financing approval/decline or term changes, settlement authorization/execution, external transfer authorization/execution, instrument issuance, and ownership transfer.

### UNMAPPED

An action with no registered executor is not guessed or silently executed. It is persisted as `AWAITING_AUTHORITY` with `NO_REGISTERED_EXECUTOR` so the platform can add an explicit governed capability later.

## Idempotency

Each plan step receives a deterministic result identifier:

```text
AR-<planId>-<planStepId>
```

A completed or authority-waiting step is reused on retry. Document generation and other completed work are not repeated merely because the operations queue is polled again.

Failed actions remain retryable because a later execution call may replace the deterministic failed result after the underlying problem is corrected.

## Financing integration

`UnifiedMarketOperationsQueueService.executeFinancingPlan(exportPackageId)` performs the following sequence:

1. hydrate operational-intelligence records;
2. refresh Phase 2 context reasoning for the export package;
3. obtain the current deterministic `AgentDecision` and `ActionPlan`;
4. execute the ready plan through `GovernedActionExecutionService`;
5. persist one `ACTION_RESULT` per plan step.

The queue also reports Phase 3 execution state beside each `FINANCING_EXPORT` item: `READY`, `BLOCKED_CONTEXT_REQUIRED`, `COMPLETED`, `AWAITING_AUTHORITY`, or `FAILED`.

## Authority boundary

Phase 3 does not change the existing SRA authority model. It automates preparation and governed execution only inside explicitly registered capabilities. It does not autonomously approve financing, change approved terms, authorize or execute settlement, authorize or execute external transfers, issue instruments, or transfer ownership.
