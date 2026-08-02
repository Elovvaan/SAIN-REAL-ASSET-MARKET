# SRA Enterprise Data Exchange (EDX) — Phase 6 Verified Snapshot Engine

## Purpose

Phase 6 turns canonical normalized records into a frozen company operating snapshot for a defined reporting period.

The snapshot answers:

```text
What is verified about this company today?
```

It automatically calculates:

- revenue;
- expenses;
- net operating result;
- assets;
- inventory;
- production;
- growth;
- cash position;
- receivables;
- payables;
- working capital;
- Verified Value.

## Persistent Record

Phase 6 adds:

```text
EDX_VERIFIED_SNAPSHOT
```

Each snapshot contains:

- snapshot ID;
- enterprise ID;
- schema version;
- snapshot date;
- reporting period;
- lifecycle state;
- title;
- visibility;
- verification status;
- verification score;
- category coverage;
- source currencies;
- primary currency;
- calculated metrics;
- source normalized-record IDs;
- excluded record IDs;
- extraction-result lineage;
- previous snapshot reference;
- frozen state;
- generation and completion timestamps.

## Snapshot Lifecycle

```text
GENERATING
-> VERIFYING
-> COMPLETE
-> SUPERSEDED
-> ARCHIVED
```

A newly completed snapshot supersedes the previous complete snapshot for the same enterprise.

## Eligible Source Records

The engine reads canonical `EDX_NORMALIZED_RECORD` records for the enterprise and reporting period.

Included verification states:

- SOURCE_CONFIRMED;
- STRUCTURE_VALIDATED;
- CROSS_CHECKED;
- VERIFIED.

Pending, rejected, or superseded normalized records are excluded and recorded in the snapshot's excluded-record list.

## Metric Construction

### Revenue

Built from:

- DAILY_GROSS_REVENUE;
- DAILY_NET_REVENUE.

### Expenses

Built from:

- DAILY_EXPENSE.

### Assets

```text
ASSET_ADDITION - ASSET_DISPOSITION
```

### Inventory

Uses the latest INVENTORY_VALUE when available. Otherwise it uses INVENTORY_MOVEMENT totals.

### Production

Built from:

- PRODUCTION_OUTPUT.

### Cash Position

Uses the latest value from:

- CASH_POSITION;
- BANK_SETTLEMENT_SUMMARY.

### Receivables and Payables

Uses the latest values from:

- RECEIVABLE_BALANCE;
- PAYABLE_BALANCE.

### Growth

Compares current revenue against the enterprise's previous complete or superseded snapshot.

### Verified Value

Phase 6 calculates operating Verified Value as:

```text
assets
+ inventory
+ cash position
+ receivables
+ positive net operating result
```

This is the EDX operating-snapshot value. Final marketplace eligibility remains the responsibility of the existing Verified Value Package and Verified Value Engine workflows.

## Verification Score

Normalized records contribute weighted verification value:

```text
PENDING               20%
SOURCE_CONFIRMED      50%
STRUCTURE_VALIDATED   70%
CROSS_CHECKED         85%
VERIFIED             100%
```

Snapshot status:

```text
85-100  VERIFIED
60-84   SUBSTANTIALLY_VERIFIED
0-59    PARTIALLY_VERIFIED
```

## Coverage

Required operating categories:

- revenue;
- expenses;
- assets;
- inventory;
- production;
- cash position.

Coverage percentage shows how many of these categories contain eligible source records.

## Source Traceability

```text
Verified Snapshot Metric
        ↓
Normalized Record IDs
        ↓
Extraction Result IDs
        ↓
Approved Filtered Source Records
        ↓
Enterprise Source System
```

The snapshot stores references rather than duplicating private upstream records into marketplace views.

## API Surface

Base path:

```text
/api/edx
```

Endpoints:

```text
GET  /snapshots
GET  /snapshots/latest?enterpriseId=...
GET  /snapshots/:snapshotId
GET  /snapshots/:snapshotId/sources
GET  /snapshots/:snapshotId/verification
POST /snapshots/generate
POST /snapshots/:snapshotId/archive
```

## Generation Example

```json
{
  "enterpriseId": "ENT-1001",
  "periodStart": "2026-08-02T00:00:00.000Z",
  "periodEnd": "2026-08-02T23:59:59.999Z",
  "primaryCurrency": "USD",
  "visibility": "PRIVATE"
}
```

## Example Output

```text
Today's Verified Snapshot

Revenue ............. 2,842,115
Expenses ............ 1,921,330
Cash Position ....... 487,900
Inventory ........... 1,244,800
Production .......... 18,442
Growth .............. +6.4%
Verified Value ...... 9,846,210
Verification ........ VERIFIED
```

## Audit and Lifecycle Events

- EDX_SNAPSHOT_GENERATING;
- EDX_SNAPSHOT_VERIFYING;
- EDX_SNAPSHOT_COMPLETE;
- EDX_SNAPSHOT_SUPERSEDED;
- EDX_SNAPSHOT_ARCHIVED.

## Protection Rules

1. A snapshot cannot be generated without eligible normalized records.
2. Only records belonging to the selected enterprise and reporting period are included.
3. Source verification states determine inclusion.
4. Every included and excluded normalized record remains identified.
5. Every completed snapshot is frozen.
6. New complete snapshots supersede previous complete snapshots without deleting them.
7. Archived snapshots remain part of permanent history.
8. Snapshot visibility does not itself authorize marketplace publication.
9. Multiple currencies are disclosed; no hidden currency conversion is performed.
10. Final Verified Value Package formation remains a separate phase.

## Phase 6 Exit Criteria

Phase 6 is complete when:

- Verified Snapshots persist;
- metrics are generated automatically from canonical normalized records;
- verification score and category coverage are calculated;
- every metric remains traceable to normalized records and extraction results;
- previous snapshots are preserved and superseded correctly;
- growth is calculated from snapshot history;
- snapshots can be listed, retrieved, archived, and inspected through APIs;
- the live health endpoint reports the Verified Snapshot Engine as active.
