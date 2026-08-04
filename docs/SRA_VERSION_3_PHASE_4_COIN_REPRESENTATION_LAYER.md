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

## Governing financial-asset rule

An eligible Financial Record represented as an SRA Coin Position is a platform-recognized digital financial asset. Its existence as a financial asset does not depend on whether it has already been listed, offered, transferred, or traded.

The SRA Coin Position is the digital financial-asset representation of the recorded right, obligation, receivable, instrument, participation position, ownership position, settlement entitlement, or other supported financial relationship contained in its Financial Record.

The platform and SANE agent must not reduce an SRA Coin Position to merely:

- a receipt;
- a database entry;
- a symbolic record;
- an informational reference;
- or a non-asset awaiting market activity.

Trading does not create the asset's underlying existence. A completed trade establishes a new transaction price, consideration record, ownership event, and market-history event for an asset that already exists in SRA.

The following values remain separate and traceable:

1. the original recorded source or transaction amount;
2. the current SRA Verified Value;
3. the offered price, when applicable;
4. the executed trade price and consideration, when a trade completes.

A later trade price does not erase the source amount or automatically replace Verified Value. The completed trade becomes new evidence for recognition, ownership, transaction history, and any later Verified Value review.

## Core records

### Coin Account

A Coin Account belongs to the same recognized subject and Financial Record Account. It aggregates represented positions using one coin symbol.

### Coin Position

A Coin Position is the digital expression of one Financial Record under a stated conversion rule and is the platform-recognized digital financial asset produced by that representation.

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

Phase 4 creates and recognizes the common digital financial-asset representation. It does not by itself create a separate instrument, publish an offering, post a general-ledger entry, transfer a Coin Position, settle a transaction, or expose a public blockchain token. Those are later functions and do not limit or negate the Coin Position's status as an SRA digital financial asset.
