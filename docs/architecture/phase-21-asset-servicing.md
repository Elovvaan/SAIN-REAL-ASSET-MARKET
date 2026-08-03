# Phase 21 — Asset Servicing

## Purpose

Phase 21 extends the SRA lifecycle beyond settlement. A settled Asset Account can now be monitored through obligations, payments, insurance, taxes, inspections, maintenance, performance, exceptions, and completion.

```text
Settled Asset Account
-> Asset Servicing Account
-> Scheduled Obligations
-> Servicing Events
-> Performance and Exception Monitoring
-> Completion or Closure
```

## Persistent Records

```text
ASSET_SERVICING_ACCOUNT
ASSET_SERVICING_OBLIGATION
ASSET_SERVICING_EVENT
```

## Servicing Account

The servicing account links the post-settlement relationship to:

```text
Asset Account
Home Project
Settlement
Owner
Servicer
Review schedule
Insurance requirements
Tax monitoring requirements
Inspection frequency
```

Supported account states:

```text
ACTIVE
WATCH
DELINQUENT
DEFAULTED
COMPLETED
CLOSED
ARCHIVED
```

## Obligations

Obligations can represent:

```text
PAYMENT
INSURANCE
TAX
INSPECTION
MAINTENANCE
VALUATION
COVENANT
REPORTING
OTHER
```

Obligation states:

```text
SCHEDULED
DUE
PAID
PAST_DUE
WAIVED
CANCELLED
```

A payment reference is required before an obligation can be marked paid.

## Servicing Events

Supported event types:

```text
PAYMENT
INSURANCE
TAX
INSPECTION
VALUATION
MAINTENANCE
COVENANT
PERFORMANCE
EXCEPTION
COMPLETION
```

Each event preserves occurrence time, amount where relevant, source references, evidence references, details, and recording actor.

## Summary

The account summary reports:

```text
Total obligations
Due and past-due obligations
Paid obligations
Total servicing events
Payment count and total payments
Insurance events
Tax events
Inspections
Exceptions
```

## API

Base path:

```text
/api/servicing
```

Endpoints:

```text
GET  /accounts
POST /accounts
GET  /accounts/:servicingAccountId
POST /accounts/:servicingAccountId/transition
GET  /accounts/:servicingAccountId/summary
GET  /obligations
POST /obligations
GET  /obligations/:obligationId
POST /obligations/:obligationId/transition
GET  /events
POST /events
```

## Boundary

Phase 21 records and coordinates servicing activity. It does not claim to be a licensed mortgage servicer, insurance carrier, tax authority, property inspector, trustee, or debt collector. External regulated or professional parties may perform those functions while SRA records their authorized evidence and lifecycle events.
