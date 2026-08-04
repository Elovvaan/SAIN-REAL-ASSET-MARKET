# SRA Version 3 — Phase 5 Instrument Engine

Phase 5 converts an eligible SRA Coin Position into a separately recorded instrument with defined terms, rights, obligations, restrictions, conditions, governing references, and lifecycle states.

## Locked flow

```text
Market Observation
→ SAIN Recognition Assessment
→ Financial Record
→ SRA Coin Position
→ SRA Instrument
```

Every instrument preserves its full lineage back to the originating market observation and source evidence.

## Instrument record

An `SRA_INSTRUMENT` contains:

- instrument identity and type;
- linked Coin Position, Coin Account, Financial Record, Recognition Assessment, and Observation;
- issuer and holder references;
- SRA Coin denomination and principal quantity;
- issue and maturity terms;
- return and payment terms where defined;
- transferability and settlement unit;
- rights, obligations, restrictions, and conditions;
- activation, default, and maturity events;
- governing reference;
- complete status history and lifecycle events.

## Principal rule

The instrument principal cannot exceed the quantity represented by its source Coin Position. The engine prevents more than one open instrument from being created from the same Coin Position.

## States

```text
DRAFT
RECORDED
ACTIVE
RESTRICTED
MATURED
CANCELLED
CLOSED
```

## API

```text
GET  /api/financial-records/instruments
GET  /api/financial-records/instruments/summary
GET  /api/financial-records/instruments/:instrumentId
POST /api/financial-records/instruments/from-coin-position/:coinPositionId
POST /api/financial-records/instruments/:instrumentId/state
```

## Phase boundary

Phase 5 creates and records the instrument. It does not execute transactions, settle obligations, transfer ownership, publish an offering, or post transaction-ledger activity. Those functions remain in the later locked phases.
