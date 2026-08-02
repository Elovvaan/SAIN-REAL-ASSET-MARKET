# SRA Enterprise Data Exchange (EDX) — Phase 3 Permission Engine

## Purpose

Phase 3 implements company-controlled extraction policies on top of the Phase 2 enterprise connection layer.

A connection authorizes communication with a source system. An extraction policy authorizes a specific record category, field set, aggregation level, purpose, recipient class, visibility level, time range, frequency, retention period, and revocation behavior.

Connecting a source does not authorize data extraction or publication.

## Persistent Record

Phase 3 adds the `EDX_EXTRACTION_POLICY` record type.

Each policy records:

- policy ID;
- enterprise ID;
- enterprise connection ID;
- record category;
- permitted fields;
- excluded fields;
- aggregation level;
- time range;
- extraction frequency;
- purpose;
- recipient class;
- named recipient where applicable;
- visibility;
- retention period;
- revocation behavior;
- conditions;
- lifecycle state;
- approval and revocation records;
- created and updated timestamps.

## Policy Lifecycle

```text
DRAFT
-> ACTIVE
-> SUSPENDED
-> ACTIVE
-> REVOKED
-> ARCHIVED
```

Rules:

- DRAFT may activate or archive.
- ACTIVE may suspend or revoke.
- SUSPENDED may reactivate, revoke, or archive.
- REVOKED may only archive.
- ARCHIVED is final.

Editing an active policy returns it to DRAFT and clears its previous approval so the company must approve the changed version again.

## Visibility Levels

- PRIVATE;
- INTERNAL;
- INSTITUTIONAL;
- MARKETPLACE;
- PUBLIC.

Visibility is separate from source connection authorization.

## Recipient Classes

- COMPANY_ONLY;
- APPROVED_COMPANY_STAFF;
- SRA_INSTITUTIONAL_REVIEW;
- NAMED_INSTITUTION;
- APPROVED_MARKETPLACE_PARTICIPANTS;
- PUBLIC_PROJECTION.

Enforced pairings:

```text
PUBLIC      -> PUBLIC_PROJECTION
MARKETPLACE -> APPROVED_MARKETPLACE_PARTICIPANTS
```

A named institution policy must identify the intended recipient.

## Aggregation Levels

- RAW_APPROVED_FIELDS;
- TRANSACTION_SUMMARY;
- DAILY_SUMMARY;
- WEEKLY_SUMMARY;
- MONTHLY_SUMMARY;
- CUSTOM_SUMMARY.

`RAW_APPROVED_FIELDS` requires an explicit permitted-field list.

## Field-Level Rules

A field cannot appear in both the permitted and excluded lists.

Example:

```text
Record category: DAILY_NET_REVENUE
Permitted fields:
- posting_date
- currency
- net_total

Excluded fields:
- customer_name
- customer_email
- order_notes
```

The future extraction engine must use the policy evaluation result as its allowed field contract.

## Purpose Limitation

Every policy requires a stated purpose.

Examples:

- prepare a private daily operating snapshot;
- support institutional review;
- prepare a marketplace revenue summary;
- prepare a public aggregated company metric;
- support a Verified Value Package.

The permission engine returns the authorized purpose with every successful evaluation.

## Policy Evaluation

The evaluation endpoint verifies:

- policy exists;
- policy is active;
- linked connection is connected, active, or degraded;
- enterprise identity matches when supplied;
- requested record category matches;
- requested visibility matches.

Successful evaluation returns:

- permitted fields;
- excluded fields;
- aggregation level;
- purpose;
- recipient class;
- named recipient;
- visibility;
- retention period;
- revocation behavior;
- conditions.

## API Surface

Base path:

```text
/api/edx
```

Endpoints:

```text
GET    /policies
GET    /policies/:policyId
POST   /policies
PUT    /policies/:policyId
POST   /policies/:policyId/transition
POST   /policies/:policyId/evaluate
```

Policy listing may be filtered by:

- enterprise ID;
- connection ID;
- lifecycle state;
- visibility.

## Example Policy Creation

```json
{
  "connectionId": "EDX-EC-1234ABCD",
  "recordCategory": "DAILY_NET_REVENUE",
  "permittedFields": ["posting_date", "currency", "net_total"],
  "excludedFields": ["customer_name", "customer_email", "order_notes"],
  "aggregationLevel": "DAILY_SUMMARY",
  "extractionFrequency": "DAILY",
  "purpose": "Prepare the company's private daily Verified Snapshot",
  "recipientClass": "COMPANY_ONLY",
  "visibility": "PRIVATE",
  "retentionDays": 365
}
```

## Approval Flow

```text
Enterprise Connection Available
        ↓
Policy Created in DRAFT
        ↓
Company Reviews Category, Fields, Purpose, Recipient, and Visibility
        ↓
Policy Activated
        ↓
Extraction Engine Evaluates Policy
        ↓
Only Authorized Data May Move
```

## Revocation

Revocation stops future authorized use under the policy.

Default behavior:

```text
STOP_FUTURE_EXTRACTION_RETAIN_AUTHORIZED_HISTORY
```

Previously authorized immutable lifecycle records remain for audit and reconciliation. Revocation does not silently delete transaction history.

## Audit and Lifecycle Events

- EDX_POLICY_CREATED;
- EDX_POLICY_UPDATED;
- EDX_POLICY_ACTIVE;
- EDX_POLICY_SUSPENDED;
- EDX_POLICY_REVOKED;
- EDX_POLICY_ARCHIVED.

## Protection Rules

1. A policy cannot reference a missing enterprise connection.
2. The record category must already be approved on the connection.
3. A draft connection cannot receive an extraction policy.
4. An active policy requires an available connection.
5. Fields cannot be simultaneously permitted and excluded.
6. Raw-field extraction requires explicit permitted fields.
7. Marketplace and public visibility require matching recipient classes.
8. Named-institution sharing requires a named recipient.
9. An edited active policy must be reapproved.
10. Revoked and archived policies cannot be edited.
11. A policy does not authorize publication outside its stated visibility and recipient class.
12. The extraction engine must receive a successful evaluation before it may operate.

## Phase 3 Exit Criteria

Phase 3 is complete when:

- extraction policies persist;
- company-controlled fields, purpose, recipient, visibility, frequency, retention, and revocation behavior are recorded;
- policy lifecycle transitions are enforced;
- policy evaluation returns a machine-readable authorization contract;
- invalid visibility and recipient combinations are rejected;
- active policy edits require reapproval;
- all policy actions enter the audit and lifecycle ledgers;
- the live server exposes the permission APIs;
- the health endpoint reports the EDX Permission Engine as active.
