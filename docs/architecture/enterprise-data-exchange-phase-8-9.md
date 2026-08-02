# SRA Enterprise Data Exchange — Phases 8 and 9

## Phase 8 — Marketplace Publisher

### Purpose

Phase 8 creates an explicit company-controlled publication decision between an active Verified Value Package and the SRA marketplace.

Nothing is published automatically.

```text
Active Verified Value Package
        ↓
Company Decision
        ├── Publish Today
        └── Keep Private
```

### Persistent Records

- `EDX_PUBLICATION_DECISION`;
- `EDX_MARKETPLACE_PROJECTION`.

### Decision Types

```text
PUBLISH_TODAY
KEEP_PRIVATE
```

`KEEP_PRIVATE` immediately records that the package remains private and creates no marketplace projection.

`PUBLISH_TODAY` creates a pending decision that requires a separate company approval reference before execution.

### Publish Flow

```text
PUBLISH_TODAY selected
        ↓
Decision = PENDING
        ↓
Company approval reference recorded
        ↓
Decision = APPROVED
        ↓
Explicit execute request
        ↓
Package published
        ↓
Marketplace projection created
        ↓
Decision = EXECUTED
```

The approval and execution actions remain separate so preparing a publication request cannot silently publish the package.

### Decision States

```text
PENDING
APPROVED
DECLINED
EXECUTED
CANCELLED
```

### Marketplace Projection States

```text
PUBLISHED
WITHDRAWN
ARCHIVED
```

### Projection Contents

The marketplace projection contains only approved package-level information:

- enterprise and package references;
- package version;
- verification status and score;
- coverage percentage;
- primary currency;
- revenue;
- expenses;
- assets;
- inventory;
- production;
- growth;
- cash position;
- Verified Value;
- marketplace-readiness flags;
- supported uses;
- distribution targets;
- company approval reference;
- publication reference.

It does not expose extraction credentials, source payloads, private normalized records, or excluded fields.

### API

```text
GET  /api/edx/publication-decisions
GET  /api/edx/publication-decisions/:publicationDecisionId
POST /api/edx/publication-decisions
POST /api/edx/publication-decisions/:publicationDecisionId/approve
POST /api/edx/publication-decisions/:publicationDecisionId/execute
POST /api/edx/publication-decisions/:publicationDecisionId/decline

GET  /api/edx/marketplace-projections
GET  /api/edx/marketplace-projections/:projectionId
POST /api/edx/marketplace-projections/:projectionId/withdraw
```

### Protection Rules

1. Only an active Verified Value Package may enter publication review.
2. Publication requires package visibility of `MARKETPLACE` or `PUBLIC`.
3. Selecting Publish Today does not publish the package.
4. A company approval reference is required before approval.
5. Approval does not publish the package.
6. Execution is allowed only after approval.
7. Keep Private creates no marketplace projection.
8. Published projections may be withdrawn by an explicit action.
9. All decisions, approvals, executions, declines, and withdrawals enter the audit and lifecycle ledgers.
10. Automatic publication remains disabled.

## Phase 9 — Sane Integration

### Purpose

Sane becomes the conversational operating layer over the EDX closeout and publication workflow.

Sane reads the latest active Verified Value Package, summarizes the verified operating position, and presents two clear actions:

```text
Publish Today
Keep Private
```

### Example Response

```text
Today's operating records have closed. Revenue, inventory, production,
and Verified Value have been prepared in Verified Value Package v3.
Would you like to publish it to the marketplace or keep it private?
```

### Sane Responsibilities

Sane may:

- identify the latest active package;
- summarize verified metrics;
- display verification status and coverage;
- present Publish Today and Keep Private;
- record the company's selected path;
- prepare a pending publication decision;
- explain that company approval is still required;
- provide the approval and execution path.

Sane may not:

- publish automatically;
- generate an approval reference;
- approve on behalf of the company;
- execute publication without an approved decision;
- change package visibility silently;
- expand distribution targets beyond the approved scope.

### Sane API

```text
GET  /api/sane/edx/enterprises/:enterpriseId/publication-review
POST /api/sane/edx/publication-choice
```

The publication-review endpoint returns:

- the latest ready package;
- snapshot and package references;
- verification status;
- coverage percentage;
- package metrics;
- the conversational response;
- the two available company actions.

The publication-choice endpoint records either:

- a completed Keep Private decision; or
- a pending Publish Today decision requiring company approval.

### End-to-End Control

```text
Source Systems
        ↓
Extraction and Normalization
        ↓
Verified Snapshot
        ↓
Verified Value Package
        ↓
Sane Publication Review
        ↓
Company Choice
        ├── Keep Private → End
        └── Publish Today
                    ↓
             Company Approval
                    ↓
             Explicit Execution
                    ↓
          Marketplace Projection
```

## Exit Criteria

Phases 8 and 9 are complete when:

- publication decisions persist;
- Keep Private creates no projection;
- Publish Today remains pending until company approval;
- approval and execution are separate actions;
- marketplace projections contain only package-level approved information;
- projections may be withdrawn;
- Sane can present the latest package and the two company choices;
- Sane can prepare but cannot approve or execute publication;
- automatic publication is reported as disabled by the health endpoint;
- all publication actions are auditable.
