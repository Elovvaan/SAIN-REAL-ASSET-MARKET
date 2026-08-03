# Phase 20 — Institutional Billing

## Purpose

Phase 20 converts institution activity into recurring, auditable billing periods using the Phase 18 Fee Engine and the Phase 19 Platform Ledger.

```text
Institution Activity
-> Usage Event
-> Billing Profile
-> Billing Period
-> Fee Calculation
-> Fee Charge
-> Fee Invoice
-> Ledger Posting
```

## Persistent Records

```text
INSTITUTION_BILLING_PROFILE
INSTITUTION_USAGE_EVENT
INSTITUTION_BILLING_RUN
```

## Billing Profiles

A billing profile identifies:

```text
Institution
Billing contact
Billing cycle
Currency
Payment terms
Assigned fee schedule
Active state
```

## Usage Events

Usage events can represent activities such as:

```text
API_USAGE
REPORTING_USAGE
TREASURY_USAGE
MARKETPLACE_USAGE
SDK_USAGE
STORAGE_USAGE
SUBSCRIPTION_USAGE
```

Each event preserves institution ID, metric, units, optional base amount, source reference, occurrence time, metadata, and creating actor.

## Billing Run

A billing run:

1. Selects one institution billing profile.
2. Selects usage events inside the billing period.
3. Aggregates usage by metric.
4. Maps each metric to a Fee Engine trigger.
5. Calculates and assesses fees.
6. Creates one institution invoice when charges exist.
7. Posts the invoice to the Platform Ledger through the existing economics integration.
8. Stores the usage events, charges, invoice, total, period, and run state.

Run states:

```text
INVOICED
NO_CHARGES
```

## Controls

- An active billing profile is required.
- Usage outside the requested billing period is excluded.
- The assigned Fee Schedule controls pricing.
- Charges are created through the centralized Fee Engine.
- Invoice creation follows the existing single-payer controls.
- Ledger posting remains balanced double-entry accounting.
- Billing runs are explicit. Phase 20 does not silently run recurring billing in the background.

## API

Base path:

```text
/api/institution-billing
```

Endpoints:

```text
GET  /profiles
POST /profiles
GET  /profiles/:profileId
GET  /usage
POST /usage
GET  /runs
POST /runs
GET  /runs/:billingRunId
GET  /institutions/:institutionId/summary
```

## Boundary

Phase 20 manages platform-service billing to institutions. It does not determine investment returns, participation distributions, interest income, bank regulatory fees, or tax treatment. Those are separate economic and accounting categories.
