# SRA Enterprise Data Exchange (EDX) — Phase 7 Verified Value Package

## Purpose

Phase 7 transforms a frozen Verified Snapshot into a versioned Verified Value Package (VVP) that downstream SRA services can reference.

The package is the reusable marketplace-facing artifact. It does not replace the source snapshot. It records which verified information is available, for which authorized uses, and at which visibility level.

## Core Flow

```text
Verified Snapshot
        ↓
Verified Value Package
        ↓
Marketplace Listings
Participation Opportunities
Financing Workflows
Performance Tracking
Analytics
Institutional Review
```

## Persistent Record

Phase 7 adds:

```text
EDX_VERIFIED_VALUE_PACKAGE
```

Each package records:

- value package ID;
- enterprise ID;
- frozen snapshot reference;
- package version;
- schema version;
- package title and date;
- reporting period;
- lifecycle state;
- visibility;
- supported downstream uses;
- verification status and score;
- category coverage;
- currency presentation;
- package metrics;
- marketplace-readiness flags;
- source record count and lineage;
- activation, publication, supersession, and archive timestamps.

## Package Lifecycle

```text
DRAFT
-> GENERATING
-> VERIFYING
-> ACTIVE
-> PUBLISHED
-> SUPERSEDED
-> ARCHIVED
```

A newly generated package supersedes the previous active or published package for the same enterprise while preserving history.

## Visibility Levels

- PRIVATE;
- INSTITUTIONAL;
- MARKETPLACE;
- PUBLIC.

Public packages receive a restricted metric projection containing only:

- revenue;
- growth percentage;
- production;
- verified value.

Private, institutional, and marketplace packages retain the full authorized snapshot metric set.

## Supported Uses

- MARKETPLACE_LISTING;
- PARTICIPATION_OPPORTUNITY;
- FINANCING_WORKFLOW;
- PERFORMANCE_TRACKING;
- ANALYTICS;
- INSTITUTIONAL_REVIEW.

At least one supported use is required when generating a package.

## Marketplace Readiness

Each package exposes explicit readiness flags:

```text
listing
participation
financing
performanceTracking
analytics
institutionalReview
```

A downstream service should only use the package when its corresponding readiness flag is true.

## Package Generation Rules

1. The referenced Verified Snapshot must exist.
2. The snapshot must be COMPLETE or SUPERSEDED.
3. The snapshot must be frozen.
4. Package visibility must be recognized.
5. All requested uses must be recognized.
6. At least one supported use is required.
7. Package versions increase per enterprise.
8. Previous active or published packages are superseded, not deleted.
9. Verification, coverage, metrics, and source lineage are inherited from the snapshot.
10. Public visibility receives a restricted projection.

## Publication Rules

Only an ACTIVE package may be published.

The package visibility must be:

```text
MARKETPLACE
or
PUBLIC
```

Publication records:

- distribution targets;
- publication reference;
- publishing actor;
- publication timestamp.

Default distribution target:

```text
SRA_MARKETPLACE
```

## Lineage

The lineage endpoint returns:

```text
Verified Value Package
        ↓
Verified Snapshot
        ↓
Normalized Records
        ↓
Extraction Result References
```

This preserves traceability from marketplace use back to the company's approved source data flow.

## API Surface

Base path:

```text
/api/edx
```

Endpoints:

```text
GET  /value-packages
GET  /value-packages/latest?enterpriseId=...
GET  /value-packages/:valuePackageId
GET  /value-packages/:valuePackageId/lineage

POST /value-packages/generate
POST /value-packages/:valuePackageId/publish
POST /value-packages/:valuePackageId/archive
```

## Generation Example

```json
{
  "snapshotId": "EDX-VS-1234ABCD",
  "visibility": "MARKETPLACE",
  "supportedUses": [
    "MARKETPLACE_LISTING",
    "PARTICIPATION_OPPORTUNITY",
    "FINANCING_WORKFLOW",
    "PERFORMANCE_TRACKING",
    "ANALYTICS"
  ]
}
```

## Downstream Use Contract

```text
Marketplace Listing
        -> requires marketplaceReadiness.listing

Participation Opportunity
        -> requires marketplaceReadiness.participation

Financing Workflow
        -> requires marketplaceReadiness.financing

Performance Tracking
        -> requires marketplaceReadiness.performanceTracking

Analytics
        -> requires marketplaceReadiness.analytics

Institutional Review
        -> requires marketplaceReadiness.institutionalReview
```

## Audit and Lifecycle Events

- EDX_VALUE_PACKAGE_DRAFT;
- EDX_VALUE_PACKAGE_GENERATING;
- EDX_VALUE_PACKAGE_VERIFYING;
- EDX_VALUE_PACKAGE_ACTIVE;
- EDX_VALUE_PACKAGE_PUBLISHED;
- EDX_VALUE_PACKAGE_SUPERSEDED;
- EDX_VALUE_PACKAGE_ARCHIVED.

## Phase 7 Exit Criteria

Phase 7 is complete when:

- frozen snapshots generate persistent versioned packages;
- packages record authorized downstream uses;
- marketplace-readiness flags are machine-readable;
- visibility projections are enforced;
- marketplace and public packages can be published;
- package history is preserved through supersession;
- lineage reaches the snapshot, normalized records, and extraction results;
- package APIs are wired into the live server;
- the health endpoint reports Verified Value Packages as active.
