# SRA Enterprise Data Exchange (EDX) — Phase 2 Connection Layer

## Purpose

Phase 2 implements the persistent company-connection foundation defined in Phase 1.

This phase does not yet pull live vendor data. It creates the reusable connector registry, enterprise connection records, lifecycle controls, company-approved scope records, and API surface required before vendor adapters and extraction begin.

## Implemented Records

### EDX Connector Definition

Describes one reusable connector capability.

Fields include:

- connector definition ID;
- name;
- connector type;
- provider;
- version;
- authentication method;
- supported record categories;
- extraction modes;
- supported refresh schedules;
- field-level minimization capability;
- source timestamp behavior;
- retention behavior;
- revocation method;
- configuration schema;
- status.

### EDX Enterprise Connection

Describes one company's approved link to one source system.

Fields include:

- connection ID;
- enterprise ID;
- connector definition ID;
- source-system identifier;
- display name;
- lifecycle state;
- credential reference;
- approved scopes;
- approved record categories;
- approved field rules;
- refresh schedule;
- connector configuration;
- extraction timestamps;
- revocation record;
- created and updated timestamps.

Credentials are referenced, not stored in the domain record.

## Connection Lifecycle

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

Allowed recovery paths include:

```text
DEGRADED -> ACTIVE
SUSPENDED -> AUTHORIZATION_PENDING
SUSPENDED -> CONNECTED
SUSPENDED -> ACTIVE
```

A revoked connection may only move to archived.

## API Surface

Base path:

```text
/api/edx
```

Endpoints:

```text
GET    /connector-definitions
GET    /connector-definitions/:connectorDefinitionId
POST   /connector-definitions

GET    /connections
GET    /connections/:connectionId
POST   /connections
PUT    /connections/:connectionId
POST   /connections/:connectionId/transition
```

Connection listing may be filtered by:

- enterprise ID;
- lifecycle state;
- connector definition ID.

## Connection Creation Flow

```text
Connector Definition Exists
        ↓
Enterprise Selects Connector
        ↓
Source System Identified
        ↓
Approved Scopes Selected
        ↓
Approved Record Categories Selected
        ↓
Approved Field Rules Added
        ↓
Connection Created in DRAFT
        ↓
Authorization Pending
        ↓
Credential Reference Attached
        ↓
Connected
        ↓
Active
```

## Protection Rules

1. An enterprise connection cannot use a missing or inactive connector definition.
2. Approved record categories must be supported by the selected connector.
3. Credentials are represented only by an external credential reference.
4. A connection cannot reach CONNECTED without a credential reference.
5. Revoked and archived connections cannot be edited.
6. Invalid lifecycle transitions are rejected.
7. Every create, update, transition, suspension, revocation, and archive action enters the audit and lifecycle ledgers.
8. This phase does not grant publication authority.
9. This phase does not perform extraction.
10. This phase does not implement write-back to company systems.

## Connector Types

The implementation recognizes:

- ACCOUNTING;
- BANKING_TREASURY;
- POINT_OF_SALE;
- SALES_COMMERCE;
- INVENTORY;
- PRODUCTION;
- ERP;
- CRM;
- CONTRACTS_WORK_ORDERS;
- PAYROLL_SUMMARY;
- ASSET_REGISTER;
- PROJECT_MANAGEMENT;
- CUSTOM_API;
- STRUCTURED_FILE_IMPORT.

## Authentication Methods

- OAUTH2;
- API_KEY_REFERENCE;
- SERVICE_ACCOUNT_REFERENCE;
- SIGNED_FILE;
- NONE.

## Extraction Modes Declared by Connectors

- MANUAL;
- SCHEDULED;
- EVENT_DRIVEN.

These are connector capabilities only. Extraction execution begins in a later phase.

## Phase 2 Exit Criteria

Phase 2 is complete when:

- connector definitions persist;
- enterprise connections persist;
- company-approved scopes, categories, and field rules are recorded;
- the lifecycle is enforced;
- credential references remain isolated;
- APIs can create, list, read, update, and transition connections;
- all connection activity is auditable;
- the health endpoint reports the EDX Connector Registry and Enterprise Connection Layer as active.
