# SRA Version 3 — Phase 6 Transaction Engine

Phase 6 converts a recorded SRA Instrument into a persistent transaction record.

## Flow

```text
SRA Instrument
  → Transaction Initiation
  → Authorization
  → Execution Record
  → Pending Settlement
  → Completion Record
```

## Transaction record

Each `SRA_TRANSACTION` preserves:

- the source instrument and full lineage;
- transaction type and purpose;
- from-party and to-party;
- quantity and denomination;
- consideration, authority, conditions, and restrictions;
- settlement unit, method, rail, destination, due date, instruction reference, and external reference;
- authorization and execution actors, times, evidence, and references;
- immutable status history.

## Quantity control

Open and completed transactions reserve instrument quantity. The combined reserved quantity cannot exceed the instrument principal quantity.

## Idempotency

An optional idempotency key prevents the same transaction request from creating duplicate records.

## States

```text
INITIATED
AUTHORIZED
EXECUTED
PENDING_SETTLEMENT
COMPLETED
CANCELLED
FAILED
```

Transitions are controlled. A final transaction cannot be reopened or rewritten into another state.

## API

```text
GET  /api/financial-records/transactions
GET  /api/financial-records/transactions/summary
GET  /api/financial-records/transactions/:transactionId
POST /api/financial-records/transactions/from-instrument/:instrumentId
POST /api/financial-records/transactions/:transactionId/state
```

## Phase boundary

Phase 6 records and governs the transaction. It does not post general-ledger entries, execute an external payment rail, publish the transaction into the Transaction Market, or create marketplace listings. Those belong to later phases.
