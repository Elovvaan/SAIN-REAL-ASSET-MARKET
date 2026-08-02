# SRA Enterprise Data Exchange — Phases 10 and 11

## Phase 10 — Enterprise Dashboard

The Enterprise Dashboard presents one enterprise-scoped operating view built from the latest authorized SRA records.

The dashboard shows:

- Business Health;
- Revenue;
- Growth;
- Inventory;
- Production;
- Contracts;
- Cash;
- Verified Value;
- Marketplace Status;
- Ready to Publish.

Core flow:

```text
Latest Verified Snapshot
        +
Latest Verified Value Package
        +
Enterprise Connections and Policies
        +
Publication Decisions and Projections
        ↓
Enterprise Dashboard
```

Business Health combines snapshot verification, category coverage, connection state, policy state, and package readiness. It does not replace the underlying records.

Dashboard marketplace states include:

- PRIVATE;
- PACKAGE_READY;
- PENDING_APPROVAL;
- APPROVED;
- PUBLISHED.

`Ready to Publish` is true only when an active marketplace or public package exists and no active marketplace projection already exists.

## Phase 11 — Marketplace Intelligence

Marketplace Intelligence creates company-specific analysis from records the enterprise has authorized through active extraction policies.

Supported insights:

- operational trends;
- liquidity trends;
- inventory velocity;
- contract completion;
- asset utilization;
- marketplace readiness.

The analysis is permission-aware.

```text
Enterprise ID
        ↓
Active Enterprise Extraction Policies
        ↓
Authorized Record Categories
        ↓
Enterprise-Scoped Normalized Records and Snapshots
        ↓
Marketplace Intelligence
```

Private data from one enterprise is not used in another enterprise's report.

Phase 11 records:

- `EDX_INTELLIGENCE_REPORT`.

Reports are frozen and preserve:

- enterprise ID;
- active authorization categories;
- source snapshot references;
- derived insights;
- permission model;
- explicit confirmation that cross-enterprise private data was not used.

## API

```text
GET  /api/edx/enterprise-dashboard/:enterpriseId

GET  /api/edx/marketplace-intelligence/:enterpriseId
POST /api/edx/marketplace-intelligence/:enterpriseId/reports
GET  /api/edx/marketplace-intelligence-reports
GET  /api/edx/marketplace-intelligence-reports/:intelligenceReportId
```

## Protection Rules

1. The dashboard is scoped to one enterprise.
2. Marketplace Intelligence uses only active policy categories.
3. Private records from other enterprises are excluded.
4. Analysis does not change source records, snapshots, or packages.
5. Marketplace readiness does not publish anything.
6. Company approval remains required for publication.
7. Intelligence reports preserve the authorization context used at generation time.
8. Missing authorization removes the related insight instead of exposing the data.

## Exit Criteria

Phases 10 and 11 are complete when:

- the enterprise dashboard returns the required operating view;
- dashboard trends compare the latest two eligible snapshots;
- marketplace status and ready-to-publish state are explicit;
- company-specific intelligence derives only from active policy categories;
- intelligence reports persist with source and permission context;
- cross-enterprise private data use is disabled;
- the live server and health endpoint expose both capabilities.
