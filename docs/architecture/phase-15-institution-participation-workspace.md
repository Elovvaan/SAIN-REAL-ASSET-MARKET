# Phase 15 — Institution Participation Workspace

## Purpose

Phase 15 gives authorized institutions a dedicated workspace for participating in verified Home Projects without taking ownership of SRA's verification, readiness, or settlement workflow.

The institution does not receive a loan application to underwrite. It receives an authorized participation opportunity produced from an SRA Home Project, Verified Snapshot, Verified Value Package, Funding Plan, and customer publication authorization.

## Core Flow

```text
Home Project
-> Verified Snapshot
-> Verified Value Package
-> Funding Plan
-> Customer Publication Authorization
-> Home Participation Plan
-> Institution Review
-> Participation Commitment
-> SRA Settlement
-> Settled Participation
```

## Responsibility Boundary

SRA is responsible for:

- organizing the Home Project;
- producing and maintaining verification records;
- controlling publication authorization;
- presenting the participation opportunity;
- tracking committed capital;
- preventing over-commitment;
- evaluating settlement readiness;
- executing and recording settlement.

The institution is responsible for:

- reviewing the authorized opportunity;
- deciding whether to participate;
- selecting an amount within the remaining need;
- acknowledging participation terms;
- identifying its capital source;
- committing, declining, withdrawing, or requesting information.

The institution is not required to recreate SRA's loan approval or verification workflow.

## Persistent Records

```text
HOME_PARTICIPATION_PLAN
HOME_PARTICIPATION_COMMITMENT
```

A completed settlement may later produce or connect to the canonical:

```text
PARTICIPATION_POSITION
```

## Participation Plan States

```text
DRAFT
OPEN
FULLY_SUBSCRIBED
CLOSED
CANCELLED
ARCHIVED
```

## Commitment States

```text
INTERESTED
UNDER_REVIEW
INFORMATION_REQUESTED
COMMITTED
DECLINED
WITHDRAWN
SETTLED
```

## Controls

- Verified Snapshot and VVP are required.
- Funding Plan is required.
- Customer or company publication authorization is required.
- Participation terms and risk disclosure references are required before opening.
- Only active Institutional Operator sessions can access the institution workspace.
- Institutions can only see open opportunities they are permitted to access.
- A commitment cannot exceed the remaining participation amount.
- Duplicate active commitments from the same institution are blocked.
- Commitments cannot transition to SETTLED until the SRA Settlement is completed.
- No automatic underwriting, participation, publication, or settlement is enabled.

## Institution Workspace Queues

```text
Incoming Opportunities
Under Review
Committed Participations
Completed Projects
```

## Institution Actions

```text
Review Opportunity
Record Interest
Begin Review
Request Information
Commit Capital
Decline
Withdraw
```

## API

Base path:

```text
/api/institutions
```

Platform-operated endpoints:

```text
GET  /plans
POST /plans
GET  /plans/:planId
POST /plans/:planId/open
```

Institution-authenticated endpoints:

```text
GET  /workspace
GET  /opportunities
GET  /commitments
POST /commitments
GET  /commitments/:commitmentId
POST /commitments/:commitmentId/transition
```

## Workspace Language

The workspace uses participation language:

```text
Verified Opportunity
Participation Target
Remaining Amount
Record Interest
Commit Capital
Settlement Event
Completed Participation
```

It does not use:

```text
Loan Application
Credit Approval
Institution Underwriting
Institution Closing
```
