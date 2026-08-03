# Phase 18 — Platform Economics and Fee Engine

## Purpose

Phase 18 gives SRA one centralized, versioned system for defining, calculating, assessing, waiving, and invoicing platform fees.

```text
Platform Service Event
-> Fee Trigger
-> Active Fee Schedule
-> Matching Fee Rules
-> Fee Calculation
-> Fee Charge
-> Invoice or Settlement Allocation
```

## Persistent Records

```text
FEE_CATALOG_ITEM
FEE_SCHEDULE
FEE_CHARGE
FEE_INVOICE
```

## Fee Catalog

The catalog defines the economic services SRA may charge for without embedding prices directly into operational modules.

Example categories:

```text
PROJECT
VERIFICATION
MARKETPLACE
SETTLEMENT
TREASURY
ASSET_ACCOUNT
CUSTODY
REPORTING
API
SDK
ENTERPRISE
```

Each catalog item identifies its fee code, name, description, category, default payer type, currency, and active state.

## Fee Schedules

Schedules are versioned and effective-dated. Only one schedule is active at a time in this initial implementation. Activating a new schedule retires the previously active schedule.

Supported calculation methods:

```text
FIXED
PERCENTAGE
TIERED
USAGE
```

Rules may include:

- fixed amount;
- percentage rate;
- minimum and maximum amounts;
- unit price;
- tiers;
- payer type;
- trigger event;
- matching conditions.

## Fee Triggers

A trigger identifies the platform event that can generate charges.

Examples:

```text
HOME_PROJECT_CREATED
VERIFIED_SNAPSHOT_CREATED
VVP_CREATED
PARTICIPATION_COMMITTED
SETTLEMENT_PREPARED
SETTLEMENT_COMPLETED
TREASURY_PAYMENT_SUBMITTED
ASSET_ACCOUNT_ACTIVATED
MONTHLY_ASSET_ADMINISTRATION
API_USAGE_RECORDED
```

Automatic assessment remains disabled in Phase 18. Operational modules or authorized operators explicitly request calculation and assessment.

## Payer Assignment

Each rule identifies who bears the fee, such as:

```text
CUSTOMER
INSTITUTION
ENTERPRISE
ASSET_PROVIDER
MARKET_PROFESSIONAL
PLATFORM
```

The assessed charge also carries a concrete payer ID.

## Calculation Controls

- Only known Fee Catalog Items may be placed into schedules.
- A valid active schedule is required for calculation unless a schedule ID is supplied.
- Conditions must match before a rule applies.
- Percentage and tiered calculations require a base amount.
- Usage calculations require units.
- Minimum and maximum rules are applied after the base calculation.
- Currency and schedule version are preserved on every charge.
- Prices are not hardcoded into settlement, treasury, marketplace, or Home Project modules.

## Fee Charge Lifecycle

```text
ASSESSED
-> INVOICED
-> PAID
```

Alternative states:

```text
WAIVED
CANCELLED
```

A waiver requires a written reason and records the actor and timestamp.

## Invoice Controls

- At least one assessed charge is required.
- Every charge must exist.
- Every charge must belong to the same payer.
- Only assessed charges may be invoiced.
- Invoiced charges link back to the invoice.

## API

Base path:

```text
/api/economics
```

Endpoints:

```text
GET  /catalog
POST /catalog
GET  /catalog/:feeCode
GET  /schedules
POST /schedules
GET  /schedules/:scheduleId
POST /schedules/:scheduleId/activate
POST /calculate
GET  /charges
POST /charges
GET  /charges/:chargeId
POST /charges/:chargeId/waive
POST /invoices
```

## Economic Boundary

Phase 18 manages service fees and platform charges. It does not treat fees as interest income, investment returns, or ownership economics. Those categories require separate instrument, balance-sheet, and accounting treatment.
