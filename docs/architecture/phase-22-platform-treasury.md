# Phase 22 — Platform Treasury

## Purpose

Phase 22 gives SRA an internal treasury position across operating cash, receivables, pending settlements, committed capital, in-flight payments, reserve targets, liquidity forecasts, and treasury exceptions.

```text
Platform Ledger
+ Settlement Pipeline
+ Participation Commitments
+ Treasury Payment Orders
-> Platform Treasury Position
-> Forecast
-> Reserve Status
-> Exception Management
```

## Persistent Records

```text
PLATFORM_TREASURY_PROFILE
PLATFORM_TREASURY_FORECAST
PLATFORM_TREASURY_EXCEPTION
```

## Treasury Profile

A profile identifies:

```text
Operating cash ledger account
Receivables ledger account
Currency
Minimum operating reserve
Target operating reserve
Forecast horizon
Active state
```

## Treasury Position

The position view reports:

```text
Operating cash
Accounts receivable
Pending settlements
Committed institutional capital
In-flight treasury payments
Minimum reserve
Target reserve
Available liquidity
Reserve status
Open exceptions
Latest forecast
```

Reserve states:

```text
AT_OR_ABOVE_TARGET
ABOVE_MINIMUM
BELOW_MINIMUM
```

Available liquidity is operating cash above the minimum operating reserve. It is not a claim that all cash is legally unrestricted or immediately transferable; account restrictions and settlement obligations remain separate controls.

## Forecasting

A forecast records expected inflows and outflows for a defined horizon.

```text
Opening Cash
+ Expected Inflows
- Expected Outflows
= Projected Closing Cash
```

The forecast also calculates the gap between projected closing cash and the target operating reserve.

## Treasury Exceptions

Examples include:

```text
RESERVE_SHORTFALL
PAYMENT_EXCEPTION
SETTLEMENT_CONCENTRATION
RECEIVABLE_DELAY
BANK_CONNECTION_ISSUE
UNRECONCILED_CASH
LIQUIDITY_MISMATCH
```

Each exception preserves type, severity, source reference, description, state, resolution, and responsible actors.

## API

Base path:

```text
/api/platform-treasury
```

Endpoints:

```text
GET  /profiles
POST /profiles
GET  /profiles/:profileId
GET  /profiles/:profileId/position
GET  /forecasts
POST /forecasts
GET  /exceptions
POST /exceptions
POST /exceptions/:exceptionId/resolve
```

## Boundary

Phase 22 manages SRA's internal operating treasury view. It does not establish direct external payment-network access, create an external account relationship, authorize use of restricted customer funds, replace account reconciliation, or make regulatory liquidity and capital calculations. Those require actual account agreements, external data, legal restrictions, accounting policies, and applicable regulatory frameworks.
