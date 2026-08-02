# SRA Enterprise Data Exchange (EDX) — Phase 5 Data Normalization

## Purpose

Phase 5 converts immutable filtered extraction results into canonical SRA normalized records.

Different systems may describe the same economic activity differently:

```text
QuickBooks Revenue
Shopify Sales
Stripe Payments
        ↓
SRA DAILY_NET_REVENUE Record
```

Normalization preserves source provenance while giving every company the same record vocabulary.

## Persistent Record

Phase 5 adds `EDX_NORMALIZED_RECORD`.

Each normalized record includes:

- normalized record ID;
- enterprise ID;
- connection, policy, request, and extraction-result references;
- source row index;
- source system;
- canonical category;
- schema version;
- period start and end;
- currency;
- numeric value;
- unit;
- dimensions;
- source and extraction timestamps;
- normalization timestamp;
- provenance and mapping details;
- duplicate fingerprint;
- verification state;
- visibility;
- lifecycle state.

## Canonical Categories

- DAILY_GROSS_REVENUE;
- DAILY_NET_REVENUE;
- DAILY_EXPENSE;
- CASH_POSITION;
- RECEIVABLE_BALANCE;
- PAYABLE_BALANCE;
- INVENTORY_VALUE;
- INVENTORY_MOVEMENT;
- PRODUCTION_OUTPUT;
- COMPLETED_ORDER_COUNT;
- COMPLETED_ORDER_VALUE;
- ACTIVE_CONTRACT_VALUE;
- COMPLETED_CONTRACT_VALUE;
- ASSET_ADDITION;
- ASSET_DISPOSITION;
- PROJECT_MILESTONE;
- LABOR_COST_SUMMARY;
- BANK_SETTLEMENT_SUMMARY;
- CUSTOM_APPROVED_METRIC.

## Mapping

The engine contains default source-field candidates for each canonical category.

Example:

```text
DAILY_NET_REVENUE value candidates:
- net_total
- net_sales
- net_revenue
- amount
```

A connector or request may supply a custom mapping without changing the canonical output.

## Canonical Record Shape

```json
{
  "normalizedRecordId": "EDX-NR-...",
  "enterpriseId": "...",
  "category": "DAILY_NET_REVENUE",
  "schemaVersion": "1.0.0",
  "periodStart": "2026-08-02T00:00:00.000Z",
  "periodEnd": "2026-08-02T00:00:00.000Z",
  "currency": "USD",
  "value": 245320,
  "unit": "CURRENCY",
  "dimensions": {},
  "provenance": {},
  "verificationState": "PENDING",
  "visibility": "PRIVATE"
}
```

## Duplicate Protection

Every normalized record receives a SHA-256 fingerprint based on:

- enterprise;
- category;
- reporting period;
- value;
- currency;
- unit;
- extraction result;
- source row.

A matching fingerprint is returned as a duplicate instead of creating another record.

## Validation

Normalization rejects rows when:

- no mapped value is present;
- the mapped value is not numeric;
- the reporting timestamp is invalid;
- the category is not recognized.

Rejected rows remain listed in the normalization response with their source-row index and reason.

## Provenance

The normalized record preserves:

- extraction-result reference;
- source-payload reference;
- mapping used;
- original approved source-field names;
- source-row index.

Disallowed fields removed during Phase 4 are not restored or referenced.

## Verification States

- PENDING;
- SOURCE_CONFIRMED;
- STRUCTURE_VALIDATED;
- CROSS_CHECKED;
- VERIFIED;
- REJECTED;
- SUPERSEDED.

Phase 5 provides verification-state transitions and records the verifying actor and timestamp when a record becomes VERIFIED.

## API Surface

```text
GET  /api/edx/normalized-records
GET  /api/edx/normalized-records/:normalizedRecordId
POST /api/edx/extraction-results/:extractionResultId/normalize
POST /api/edx/normalized-records/:normalizedRecordId/verification
```

Normalized records may be filtered by:

- enterprise ID;
- category;
- extraction-result ID;
- verification state.

## Core Flow

```text
Immutable Filtered Extraction Result
        ↓
Canonical Category Selected
        ↓
Source Fields Mapped
        ↓
Values and Period Validated
        ↓
Duplicate Fingerprint Checked
        ↓
SRA Normalized Record Created
        ↓
Verification Lifecycle
```

## Protection Rules

1. Only immutable filtered extraction results may be normalized.
2. Only approved source fields from Phase 4 are available.
3. Every output uses a recognized canonical category.
4. Values must be numeric.
5. Reporting timestamps must be valid.
6. Every record preserves provenance.
7. Duplicate fingerprints do not create duplicate records.
8. Normalization does not automatically verify a record.
9. Normalization does not publish a record.
10. Verified Snapshots are created in Phase 6.

## Phase 5 Exit Criteria

Phase 5 is complete when:

- normalized records persist;
- common source aliases map into canonical SRA categories;
- custom mappings are supported;
- value and timestamp validation operates;
- provenance is preserved;
- duplicates are detected;
- row-level failures are reported;
- verification-state transitions are available;
- normalization APIs are wired into the live server;
- the health endpoint reports the EDX Normalization Engine as active.
