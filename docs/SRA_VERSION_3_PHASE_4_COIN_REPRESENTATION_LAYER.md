# SRA Version 3 — Phase 4 Coin Representation Layer

## Purpose

Phase 4 gives every eligible SRA Financial Record a common digital representation in SRA Coin units while preserving the complete chain back to the recognized market record.

```text
Market Observation
→ SAIN Recognition Assessment
→ Financial Record
→ SRA Coin Position
```

The Coin Position is not detached from its source. It records:

- the Financial Record Account;
- Financial Record ID;
- Recognition Assessment ID;
- Observation ID;
- source position amount and unit;
- conversion method and rate;
- resulting SRA Coin quantity;
- rights, obligations, and restrictions;
- source and evidence lineage;
- representation and status history.

## Core records

### Coin Account

A Coin Account belongs to the same recognized subject and Financial Record Account. It aggregates represented positions using one coin symbol.

### Coin Position

A Coin Position is the digital expression of one Financial Record under a stated conversion rule.

The default rule is:

```text
recognized amount × conversion rate = represented coin quantity
```

The default symbol is `SRA`, and the default conversion rate is `1`. Both are recorded rather than implied.

## Lifecycle states

```text
REPRESENTED
ACTIVE
RESTRICTED
RETIRED
```

Every state change is retained in status history and the lifecycle audit trail.

## API surface

```text
GET  /api/financial-records/coin-accounts
GET  /api/financial-records/coin-accounts/:coinAccountId
GET  /api/financial-records/coin-positions
GET  /api/financial-records/coin-positions/:coinPositionId
POST /api/financial-records/coin-positions/from-financial-record/:financialRecordId
POST /api/financial-records/coin-positions/:coinPositionId/state
```

## Phase boundary

Phase 4 creates the common coin representation. It does not create an instrument, publish an offering, post a general-ledger entry, transfer a coin position, settle a transaction, or expose a public blockchain token. Those functions belong to later locked phases.
