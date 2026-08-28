# Platinum Operational Intelligence

SRA's Platinum operating architecture extends the existing governed financing, settlement, servicing, marketplace, instrument, Agent OS, and workforce services. It does not replace those authoritative domain services.

## Phase 1 - Operational memory and event nervous system

Canonical records:

- `OPERATIONAL_EVENT`
- `OPERATIONAL_MEMORY`
- `AGENT_DECISION`
- `ACTION_PLAN`
- `ACTION_RESULT`
- `OUTCOME_EVALUATION`

Core reasoning loop:

`Observe -> Remember -> Decide -> Plan -> Act -> Evaluate external outcome`

An action being completed is distinct from an external outcome being verified.

## Phase 2 - Context and instruction reasoning

Phase 2 reads existing financing export records, linked transaction context, recorded evidence, servicing terms, recipient/dealer context, and operational history.

It creates persistent, idempotent `AGENT_DECISION` and `ACTION_PLAN` records. Missing settlement or servicing information is flagged rather than inferred.

## Phase 3 - Governed action execution

Phase 3 consumes READY `ACTION_PLAN` records and turns plan steps into governed execution through registered existing SRA services.

Execution classes:

- `SAFE_PREPARATION` - may execute autonomously through a registered SRA capability.
- `PROTECTED` - stops at `AWAITING_AUTHORITY` until the reserved authority is supplied through the governing workflow.
- `UNMAPPED` - stops at `AWAITING_AUTHORITY`; the agent does not invent an executor.

Each step receives a deterministic `ACTION_RESULT` ID so completed work is idempotent across retries. Failed steps remain retryable after the underlying condition is corrected.

Protected actions include financing approval/decline or approved-term changes, settlement authorization/execution, external transfer authorization/execution, instrument issuance, and ownership transfer.

Phase 3 does not create an `OUTCOME_EVALUATION` merely because SRA completed an internal action.

## Transaction Participation Gateway

Financing package generation now opens a transaction-scoped participation window for the external recipient. The window is not a general SRA account and does not grant access to administration, marketplace, ledger, treasury, servicing, or unrelated financing records.

Access requires both the funding package or financing transaction reference and the participation access code issued with the window. The access code is generated once during governed funding-package preparation, returned in the internal `ACTION_RESULT` for controlled delivery with the package, and stored only as a SHA-256 digest in the participation-window record.

The participant can:

- view a limited transaction summary;
- confirm package receipt;
- identify the processing contact and organization;
- ask ACH, settlement, instrument, document, or general processing questions;
- report a processing exception;
- upload a transaction document into private evidence storage;
- confirm that the package was submitted for processing and supply an external reference.

Every external interaction is written as a `TRANSACTION_PARTICIPATION_EVENT` and a transaction-bound `OPERATIONAL_EVENT`. This lets later reasoning use the outside party's response as recorded evidence rather than relying on disconnected email or phone context.

Participant UI:

`/transaction-participation.html`

API surface under the already-mounted participation router:

- `POST /api/participation/transaction/access`
- `POST /api/participation/transaction/receipt`
- `POST /api/participation/transaction/contact`
- `POST /api/participation/transaction/questions`
- `POST /api/participation/transaction/issues`
- `POST /api/participation/transaction/documents`
- `POST /api/participation/transaction/processing-confirmation`

The gateway closes the operational loop:

`SRA context -> decision -> plan -> governed action -> funding package -> external participant response -> operational event -> next reasoning cycle`

A participant statement such as "submitted for processing" is recorded as evidence of that participant's statement, not as proof of final settlement. Dealer acceptance, bank processing, receipt of funds, settlement completion, and other outside-world outcomes remain unresolved until their required evidence supports an `OUTCOME_EVALUATION`.
