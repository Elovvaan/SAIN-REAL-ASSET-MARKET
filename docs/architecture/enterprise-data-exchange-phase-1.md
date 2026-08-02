# SRA Enterprise Data Exchange (EDX) — Phase 1 Architecture

## Purpose

The Enterprise Data Exchange allows a company to connect its existing operating systems to SRA, approve exactly which records may be extracted, normalize those approved records into SRA record types, and prepare Verified Snapshots and Verified Value Packages for private, institutional, marketplace, or public use.

EDX lowers the cost of participation by adapting to the company's existing systems rather than requiring the company to rebuild its operations around SRA.

## Core Rule

> EDX extracts only the records and fields the company has authorized for a defined purpose, visibility level, time range, and destination.

A connector does not create general access to the company's systems.

## Position in SRA

```text
Company Systems
  -> Enterprise Data Exchange
  -> Approved Record Intake
  -> Normalization
  -> Verification
  -> Verified Snapshot
  -> Verified Value Package
  -> Company Approval
  -> SRA Marketplace or Approved Recipient
```

EDX belongs inside SRA and feeds the existing Verified Value and marketplace flow. It does not replace Permanent Asset Accounts, Evidence Packages, Verified Value Packages, Projects, True Bills, Participation Positions, or the Public Registry.

## Phase 1 Components

```text
Enterprise Data Exchange
├── Connector Registry
├── Connection Manager
├── Authorization and Consent Manager
├── Extraction Policy Engine
├── Data Minimization Filter
├── Normalization Engine
├── Provenance and Evidence Recorder
├── Verified Snapshot Contract
├── VVP Handoff Contract
├── Projection and Publication Policy
├── Audit and Lifecycle Recorder
└── Sane Guidance Layer
```

## Supported Source Classes

Phase 1 defines source classes without implementing vendor-specific connectors.

- accounting;
- banking and treasury;
- point of sale;
- sales and commerce;
- inventory;
- production;
- enterprise resource planning;
- customer relationship management;
- contracts and work orders;
- payroll summaries;
- asset registers;
- project management;
- custom application programming interfaces;
- structured file import.

Vendor-specific integrations are introduced in later phases through connector adapters.

## Connector Registry

Every connector definition must identify:

- connector type;
- provider or source class;
- supported authentication method;
- supported record categories;
- supported extraction modes;
- supported refresh schedules;
- field-level minimization capabilities;
- source timestamp behavior;
- data-retention behavior;
- revocation method;
- connector version.

A Connector Definition does not contain company credentials. It describes the reusable adapter capability.

## Enterprise Connection

An Enterprise Connection is one company's authorized link to one source system.

Required fields:

- connection ID;
- participant or company ID;
- source-system identifier;
- connector definition ID;
- connection state;
- credential reference;
- approved scopes;
- approved record categories;
- approved field rules;
- refresh schedule;
- last successful extraction;
- last failed extraction;
- revocation state;
- created and updated timestamps.

Connection lifecycle:

```text
DRAFT
-> AUTHORIZATION_PENDING
-> CONNECTED
-> ACTIVE
-> DEGRADED
-> SUSPENDED
-> REVOKED
-> ARCHIVED
```

## Authorization and Consent

Authorization must exist at two levels.

### Connection authorization

Allows SRA to communicate with the source system within defined scopes.

### Publication authorization

Allows a verified output to move beyond the company's private workspace.

Connecting a source does not authorize marketplace publication.

## Permission Dimensions

Each extraction policy must define:

- record category;
- permitted fields;
- excluded fields;
- aggregation level;
- time range;
- extraction frequency;
- purpose;
- recipient class;
- visibility level;
- retention period;
- revocation behavior.

Visibility levels:

```text
PRIVATE
INTERNAL
INSTITUTIONAL
MARKETPLACE
PUBLIC
```

Recipient classes may include:

- company only;
- approved company staff;
- SRA institutional review;
- named institution;
- approved marketplace participants;
- public projection.

## Data Minimization

EDX must reject broad ingestion when a narrower approved record can satisfy the purpose.

Examples:

```text
Approved: daily gross sales total
Not approved: customer-level purchase history

Approved: payroll expense total
Not approved: employee names and individual compensation

Approved: completed work-order count and value
Not approved: confidential customer instructions
```

The source record remains in the source system unless retention is explicitly required.

## Extraction Request

Each extraction is represented by an immutable request record.

Required fields:

- extraction request ID;
- connection ID;
- policy ID;
- requested record categories;
- requested time range;
- purpose;
- requesting actor;
- company approval reference;
- state;
- created, started, completed, and failed timestamps.

Lifecycle:

```text
REQUESTED
-> APPROVED
-> QUEUED
-> EXTRACTING
-> FILTERING
-> NORMALIZING
-> VERIFIED
-> COMPLETED
```

Failure states:

```text
REJECTED
AUTHORIZATION_EXPIRED
SOURCE_UNAVAILABLE
VALIDATION_FAILED
CANCELLED
```

## Normalized Record Contract

Every approved source record is translated into a common SRA envelope.

```json
{
  "recordId": "NR-...",
  "enterpriseId": "...",
  "sourceConnectionId": "...",
  "sourceSystem": "...",
  "category": "DAILY_REVENUE",
  "periodStart": "...",
  "periodEnd": "...",
  "currency": "USD",
  "value": "245320.00",
  "unit": "CURRENCY",
  "dimensions": {},
  "sourceTimestamp": "...",
  "extractedAt": "...",
  "policyId": "...",
  "provenance": {},
  "verificationState": "PENDING",
  "visibility": "PRIVATE"
}
```

The normalized record must preserve source provenance without exposing disallowed source fields.

## Canonical Record Categories

Phase 1 defines the initial vocabulary:

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

Additional categories require schema versioning and architecture review.

## Verification States

```text
PENDING
SOURCE_CONFIRMED
STRUCTURE_VALIDATED
CROSS_CHECKED
VERIFIED
REJECTED
SUPERSEDED
```

Verification may use:

- source authenticity;
- expected schema;
- timestamp integrity;
- duplicate detection;
- arithmetic reconciliation;
- cross-source comparison;
- approved evidence references;
- institutional review.

## Verified Snapshot

A Verified Snapshot is a time-bounded company operating record built from approved normalized records.

Required fields:

- snapshot ID;
- enterprise ID;
- reporting period;
- included normalized record IDs;
- excluded or unavailable categories;
- verification summary;
- currency presentation;
- calculated metrics;
- completeness state;
- visibility state;
- company approval state;
- created and frozen timestamps.

Snapshot lifecycle:

```text
DRAFT
-> DATA_READY
-> VERIFICATION_PENDING
-> VERIFIED
-> COMPANY_REVIEW
-> APPROVED
-> FROZEN
-> PUBLISHED
-> SUPERSEDED
-> ARCHIVED
```

A snapshot may remain private permanently.

## Verified Value Package Handoff

EDX does not independently determine final marketplace eligibility.

It prepares the approved evidence and normalized records required by the existing Verified Value Package workflow.

```text
Approved Normalized Records
  -> Verified Snapshot
  -> VVP Intake Reference
  -> Verified Value Engine
  -> Verified Value Package
```

The VVP stores references to the frozen snapshot and source provenance rather than duplicating private source data into public views.

## Projection and Publication

Publication is always a separate authorized action.

Possible projections:

- private operating snapshot;
- institutional review package;
- marketplace company summary;
- project-specific disclosure;
- public aggregated profile.

A projection contains only approved fields and calculated outputs.

```text
Private Source Record
  -> Normalized Private Record
  -> Verified Snapshot
  -> Projection Policy
  -> Approved Marketplace or Public View
```

## Security Boundaries

### Credential isolation

Credentials are stored as references in a secrets system and are never written into domain records, audit payloads, snapshots, or VVPs.

### Read-first access

Phase 1 defines EDX as read-only. Write-back connectors require a later explicit architecture decision.

### Least privilege

Each connection requests only scopes needed for approved record categories.

### Company-controlled revocation

A company can suspend or revoke a connection. Revocation stops future extraction but does not erase previously authorized immutable lifecycle records.

### Field suppression

Disallowed fields are removed before normalized records enter the SRA domain store.

### Tenant separation

One enterprise cannot access another enterprise's connections, extraction policies, records, snapshots, or credentials.

### Auditability

Connection, consent, extraction, verification, approval, publication, revocation, and failure events are recorded.

## Audit Events

Initial event vocabulary:

- EDX_CONNECTION_CREATED;
- EDX_CONNECTION_AUTHORIZED;
- EDX_CONNECTION_SUSPENDED;
- EDX_CONNECTION_REVOKED;
- EDX_POLICY_CREATED;
- EDX_POLICY_UPDATED;
- EDX_EXTRACTION_REQUESTED;
- EDX_EXTRACTION_APPROVED;
- EDX_EXTRACTION_COMPLETED;
- EDX_EXTRACTION_FAILED;
- EDX_RECORD_NORMALIZED;
- EDX_RECORD_VERIFIED;
- EDX_SNAPSHOT_CREATED;
- EDX_SNAPSHOT_APPROVED;
- EDX_SNAPSHOT_FROZEN;
- EDX_SNAPSHOT_PUBLISHED;
- EDX_PUBLICATION_REVOKED.

## Sane Responsibilities

Sane may:

- explain available source connections;
- guide company authorization;
- display requested categories and fields;
- show what will remain private;
- prepare an extraction request;
- summarize extraction results;
- identify missing records;
- prepare a Verified Snapshot;
- request company approval;
- prepare the VVP handoff;
- present publication choices.

Sane may not silently expand scopes, extract unapproved fields, publish automatically, or override revocation.

## Company Experience

```text
Connect a Source
  -> Choose Records
  -> Choose Fields and Aggregation
  -> Choose Schedule
  -> Choose Purpose and Visibility
  -> Review Authorization
  -> Extract
  -> Review Verified Snapshot
  -> Approve VVP Handoff
  -> Approve Publication or Keep Private
```

## Phase 1 Deliverables

1. EDX architecture document.
2. Connector, connection, policy, extraction, normalized-record, and snapshot contracts.
3. Canonical record-category vocabulary.
4. Permission and visibility model.
5. Security-boundary definition.
6. Audit-event vocabulary.
7. Verified Snapshot lifecycle.
8. VVP handoff definition.
9. Sane responsibility definition.
10. SRA master-architecture integration.

## Phase 1 Exit Criteria

Phase 1 is complete when:

- the authoritative EDX architecture is merged;
- platform boundaries are explicit;
- every future connector must use the same consent and normalized-record model;
- private, institutional, marketplace, and public projections are separated;
- the Verified Snapshot and VVP handoff are defined;
- no vendor-specific implementation is required to understand the operating flow.
