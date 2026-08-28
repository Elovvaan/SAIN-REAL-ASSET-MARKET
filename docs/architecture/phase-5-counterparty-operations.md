# Phase 5 — Conversational Counterparty Operations and Governed Exception Resolution

Phase 5 turns the transaction participation window into a transaction-grounded operating contact without creating a second financing workflow.

## Operating contract

A counterparty authenticates to one funding package and submits a processing clarification or exception. SRA records the participation event first. `CounterpartyOperationsService` then loads the authoritative export-package context, Phase 2 instruction reasoning, and Phase 4 external-outcome state before producing a response.

The response is persisted as `COUNTERPARTY_OPERATION_RESPONSE` and its governed case as `COUNTERPARTY_OPERATION_CASE`. Repeating the same event reuses the same deterministic response rather than creating duplicate cases.

## Authority boundary

Ordinary processing clarification may be answered from recorded transaction state. Missing authoritative fields block instruction rather than being inferred. A request to change financing amount or terms, authorize settlement, authorize or execute an external transfer, issue an instrument, transfer ownership, or authorize payment is recorded as `AWAITING_AUTHORITY` and does not mutate the financing package.

Processing exceptions are retained as transaction-bound cases. The agent may explain the recorded state and identify the next corrective step, but it cannot convert a counterparty assertion into verified settlement. Phase 4 remains the external-outcome authority.

## Participation API behavior

`POST /questions` records the counterparty question and returns the persisted SRA counterparty response in the same request.

`POST /issues` records the exception and returns the governed exception response in the same request.

`POST /conversation/latest` lets an authenticated participation-window user retrieve the latest response and current Phase 5 case status for that funding package.

## Phase boundary

Phase 5 ends after the issue is answered, blocked for missing recorded context, retained as an active exception, or escalated to principal authority. Phase 6 may use resolved cases and verified outcomes to resume eligible downstream workflow automatically.
