# SRA Transaction Market Foundation

## Purpose

The SRA Transaction Market is a market read model built from recorded economic activity.

It does not turn a transaction into a stock, bond, token, certificate, or separate investment instrument. A transaction remains a record of an authorized event. The Transaction Market observes, normalizes, measures, and displays those records as verified market activity.

## Governing distinction

```text
Asset Market
  -> What assets, projects, offerings, and participation positions are available?

Transaction Market
  -> What authorized value movement has actually been recorded?
```

The two views operate together but are not interchangeable.

## Existing SRA sources

The Transaction Market derives its read model from existing persistent records:

- `LEDGER_ENTRY`
- `SRA_SETTLEMENT`
- `SRA_SETTLEMENT_RECORD`
- `SETTLEMENT_RAIL_INSTRUCTION`
- `TREASURY_PAYMENT_ORDER`
- `VERIFIED_MARKET_EVENT`

No source record is replaced. Each source remains authoritative for its own workflow.

## Normalized transaction view

Each source record is projected into a common transaction view containing:

- transaction identifier;
- source record type;
- transaction kind;
- state;
- amount;
- currency;
- occurrence time;
- asset and project references;
- participant reference;
- source and destination account references;
- external or internal reference identifier;
- verification indicator.

The normalized transaction view is a read model. It does not duplicate ownership or override the underlying ledger, settlement, treasury, or verified-event record.

## Market measures

The marketplace snapshot now includes `transactionMarket` with:

- `status`
- `transactionCount`
- `completedTransactionCount`
- `pendingTransactionCount`
- `verifiedTransactionCount`
- `totalVolume`
- `verifiedVolume`
- `averageTransactionSize`
- `latestOccurredAt`
- `volumeByKind`
- `recentTransactions`

When no transaction records exist, the Transaction Market reports `READY`. It becomes `ACTIVE` when qualifying records are present.

## Flow

```text
Authorized activity
  -> Existing SRA source record
  -> Persistent storage
  -> Normalized transaction view
  -> Transaction Market calculation
  -> Marketplace snapshot
  -> Sane and UI presentation
```

## Verification rule

A transaction can appear in the Transaction Market before final verification when its source workflow is pending or in progress. Verified volume is counted separately.

A record is treated as verified when:

- it is a `VERIFIED_MARKET_EVENT`; or
- the source record contains verification or evidence references.

Pending, completed, and verified are separate classifications. They must not be presented as the same condition.

## Current API integration

The existing marketplace response includes the Transaction Market under:

```text
GET /api/marketplace
  -> transactionMarket
```

This preserves the Marketplace Engine as SRA's front door and avoids creating a detached second platform.

## Next implementation layer

The next layer should add explicit transaction-production hooks so new ledger postings, settlements, subscriptions, and treasury executions consistently expose:

- participant and account references;
- transaction kind;
- transaction amount and currency;
- event timestamps;
- evidence and verification references;
- reversal or correction linkage.

After those producers are standardized, the UI can present transaction volume, verified activity, settlement activity, and value movement without relying on speculative pricing.
