# SRA V9 — Institutional Custody & Records Layer

## Purpose

V9 inserts a controlled institutional layer behind V4V. Customers present assets and private evidence through V4V. SRA then controls the evidence, creates filing records, evaluates collateral scheduling, tracks capital positions, and records settlement, setoff, discharge, and release.

## Core Flow

```text
V4V Submission
    ↓
Private Evidence Package (EP)
    ↓
Custody Record (CR)
    ↓
Institutional Review
    ↓
Verified Value Package (VVP)
    ↓
Asset Account (AA)
    ↓
True Bill / Position (TB)
    ↓
Collateral Schedule (CS)
    ↓
Capital Deployment
    ↓
Settlement Record (SR)
    ↓
Setoff / Satisfaction / Release
    ↓
Discharge Record (DR)
    ↓
Custody Release, Substitution, or Continued Hold
```

## Customer-Facing Boundary

Customers may see V4V status, institutional review status, Verified Value status, and an approved marketplace representation. They do not receive internal document-location data, collateral schedules, lendable-value calculations, pledge identifiers, setoff calculations, discharge filing details, or capital-utilization records unless the platform deliberately exposes a permitted record.

## Custody Record

The Custody Record tracks:

- filing number;
- asset and evidence-package linkage;
- private document identifiers;
- physical, digital, or hybrid custody type;
- controlled storage location;
- access classification;
- custody status;
- collateral designation state;
- collateral-schedule linkage;
- append-only chain-of-custody events.

## Collateral Schedule

The Collateral Schedule is an internal institutional record. It may track verified value, designated amount, document-control status, conflicting-claim review, automated identification, reporting status, lendable value, and haircut when those values are actually established.

An internal status such as `ELIGIBILITY_REVIEW` or `INTERNAL_REVIEW` does not represent acceptance by an outside institution, a Reserve Bank, or any other program. A completed external pledge requires the applicable institution's own approvals and procedures.

## Discharge Record

Discharge remains a first-class accounting method. The record identifies:

- opening position;
- position type;
- instruments and VVPs supporting the workflow;
- settlement value applied;
- setoff applied;
- released amount;
- remaining balance;
- discharge method;
- posting state and date;
- permanent filing number and record hash.

The discharge record proves how an outstanding position ceased to remain open. It does not merely record that money moved.

## Filing Sequence

```text
EP — Evidence Package
CR — Custody Record
VVP — Verified Value Package
AA — Asset Account
TB — True Bill or purpose-bound instrument
CS — Collateral Schedule
SR — Settlement Record
DR — Discharge Record
```

## V9 Objects and APIs

- `CustodyRecord`
- `DischargeRecord`
- `GET /api/custody`
- `GET /api/custody/custody-records`
- `GET /api/custody/collateral-schedules`
- `GET /api/custody/discharge-records`

## Current Build Boundary

V9 currently provides domain objects, seeded institutional records, API views, filing references, workflow visualization, and internal/public separation. It does not yet provide a persistent database, staff authentication, role-based access enforcement, outside-program reporting, electronic signatures, or production collateral transmission.
