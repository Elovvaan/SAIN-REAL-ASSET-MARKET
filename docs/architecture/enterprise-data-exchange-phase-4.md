# SRA Enterprise Data Exchange (EDX) — Phase 4 Extraction Engine

## Purpose

Phase 4 implements the first operational extraction workflow.

The engine does not connect directly to outside vendors yet. It accepts source payloads through the EDX API, verifies that an active company extraction policy authorizes the requested use, filters the payload down to approved fields, records the result, and closes the extraction lifecycle.

This creates the runtime contract that later vendor adapters must use.

## Persistent Records

Phase 4 adds:

- `EDX_EXTRACTION_REQUEST`;
- `EDX_EXTRACTION_RESULT`.

## Extraction Request

An extraction request records:

- extraction request ID;
- enterprise ID;
- enterprise connection ID;
- extraction policy ID;
- connector definition ID;
- source-system identifier;
- requested record category;
- requested time range;
- purpose;
- visibility;
- recipient class;
- requesting actor;
- company approval reference;
- lifecycle state;
- source, approved, and rejected record counts;
- source payload reference;
- timestamps;
- error state.

## Request Lifecycle

```text
REQUESTED
-> APPROVED
-> QUEUED
-> EXTRACTING
-> FILTERING
-> COMPLETED
```

Terminal failure states:

```text
REJECTED
AUTHORIZATION_EXPIRED
SOURCE_UNAVAILABLE
VALIDATION_FAILED
CANCELLED
```

## Authorization Enforcement

Before request creation, the engine evaluates the policy against:

- enterprise ID;
- record category;
- visibility.

Before execution, the policy is evaluated again.

This second evaluation prevents a queued request from continuing after:

- policy suspension;
- policy revocation;
- connection suspension;
- connection revocation;
- visibility mismatch;
- enterprise mismatch;
- record-category mismatch.

If the authorization is no longer active, the request moves to `AUTHORIZATION_EXPIRED`.

## Company Approval

A request begins in `REQUESTED`.

It cannot move to `APPROVED` without a `companyApprovalReference`.

```text
Active Policy
        ↓
Extraction Requested
        ↓
Company Approval Reference Recorded
        ↓
Approved
        ↓
Queued
        ↓
Executed
```

## Source Payload Intake

Phase 4 accepts source data as an array of record objects:

```json
{
  "sourcePayloadReference": "FILE-OR-CONNECTOR-REFERENCE",
  "sourceTimestamp": "2026-08-02T16:00:00.000Z",
  "sourceRecords": [
    {
      "posting_date": "2026-08-02",
      "currency": "USD",
      "net_total": 245320,
      "customer_name": "Private customer",
      "customer_email": "private@example.com"
    }
  ]
}
```

The source payload reference identifies the upstream file, connector response, or adapter event without placing credentials in the extraction record.

## Approved-Field Filtering

The extraction engine uses the policy evaluation result as the field contract.

Example policy:

```text
Permitted:
- posting_date
- currency
- net_total

Excluded:
- customer_name
- customer_email
```

Result:

```json
{
  "posting_date": "2026-08-02",
  "currency": "USD",
  "net_total": 245320
}
```

Disallowed fields do not enter the persistent extraction result.

## Extraction Result

The extraction result records:

- extraction result ID;
- extraction request ID;
- enterprise, connection, and policy references;
- record category;
- aggregation level;
- purpose;
- visibility;
- recipient class;
- permitted and excluded field contracts;
- source payload reference;
- source timestamp;
- extraction timestamp;
- source, approved, and rejected record counts;
- approved filtered records;
- immutable result state.

Result state:

```text
IMMUTABLE_FILTERED_RESULT
```

A result is not a normalized SRA record yet. Normalization begins in Phase 5.

## API Surface

Base path:

```text
/api/edx
```

Endpoints:

```text
GET    /extraction-requests
GET    /extraction-requests/:extractionRequestId
POST   /extraction-requests
POST   /extraction-requests/:extractionRequestId/transition
POST   /extraction-requests/:extractionRequestId/execute

GET    /extraction-results
GET    /extraction-results/:extractionResultId
```

## Execution Example

```text
POST /api/edx/extraction-requests
        ↓
POST /api/edx/extraction-requests/:id/transition
state = APPROVED
companyApprovalReference = ...
        ↓
POST /api/edx/extraction-requests/:id/execute
sourceRecords = [...]
        ↓
Filtered immutable result created
        ↓
Request moves to COMPLETED
```

## Audit and Lifecycle Events

- EDX_EXTRACTION_REQUESTED;
- EDX_EXTRACTION_APPROVED;
- EDX_EXTRACTION_QUEUED;
- EDX_EXTRACTION_EXTRACTING;
- EDX_EXTRACTION_SOURCE_RECEIVED;
- EDX_EXTRACTION_FILTERING;
- EDX_EXTRACTION_RESULT_CREATED;
- EDX_EXTRACTION_RESULT_LINKED;
- EDX_EXTRACTION_COMPLETED;
- EDX_EXTRACTION_REJECTED;
- EDX_EXTRACTION_AUTHORIZATION_EXPIRED;
- EDX_EXTRACTION_SOURCE_UNAVAILABLE;
- EDX_EXTRACTION_VALIDATION_FAILED;
- EDX_EXTRACTION_CANCELLED.

## Protection Rules

1. No extraction request can be created without an active policy.
2. Policy authorization is checked before creation and again before execution.
3. Company approval is required before execution.
4. Only approved fields enter the persistent result.
5. Excluded fields override permitted fields.
6. Source records must be structured objects.
7. Partial lifecycle jumps are rejected.
8. Completed and failed requests cannot be reopened.
9. Extraction results are immutable filtered intake records.
10. Phase 4 does not normalize values into canonical SRA record categories.
11. Phase 4 does not publish results.
12. Phase 4 does not write back into company systems.

## Phase 4 Exit Criteria

Phase 4 is complete when:

- extraction requests persist;
- company approval is enforced;
- policy authorization is rechecked at execution;
- extraction lifecycle states are enforced;
- approved-field filtering operates;
- extraction results persist without disallowed fields;
- request and result records are linked;
- all actions enter audit and lifecycle records;
- extraction APIs are wired into the live server;
- the health endpoint reports the EDX Extraction Engine as active.
