# SRA Home Project Financing Workspace

## Purpose

The Home Project Financing Workspace connects a customer's verified home-acquisition record to an explicit funding plan, customer approval, settlement readiness, closing, and the post-closing asset record.

It does not publish, approve, commit, or settle financing automatically.

## Core Flow

```text
Home Project
-> Data Collection
-> Verified Snapshot
-> Verified Value Package
-> Funding Plan
-> Customer Review
-> Customer Approval
-> Funding Commitment
-> Settlement Readiness
-> Settlement
-> Ongoing Asset Record
```

## Home Project

A Home Project records:

- customer;
- property address and identity;
- purchase price;
- verified buyer funds;
- funding needed;
- target closing date;
- Verified Snapshot reference;
- Verified Value Package reference;
- participants;
- document references;
- Funding Plan reference;
- settlement reference;
- lifecycle state.

### Lifecycle

```text
DRAFT
-> DATA_COLLECTION
-> PACKAGE_READY
-> FUNDING_PLANNING
-> FUNDING_APPROVED
-> SETTLEMENT_READY
-> SETTLED
-> ARCHIVED
```

A project may be cancelled before settlement.

## Funding Plan

The Funding Plan defines how the purchase price will be met.

```text
Purchase Price
- Verified Buyer Funds
= Funding Needed
```

The complete plan may combine:

- buyer funds;
- institution financing;
- participation capital;
- seller financing;
- a platform instrument;
- a grant;
- another approved source.

Every source records its amount, provider, instrument reference, status, and terms reference where applicable.

### Funding Plan Lifecycle

```text
DRAFT
-> READY_FOR_REVIEW
-> CUSTOMER_APPROVED
-> COMMITTED
-> SETTLEMENT_READY
-> SETTLED
-> ARCHIVED
```

A plan with an uncovered funding gap cannot enter review.

Customer approval requires a separate approval reference.

Settlement readiness requires settlement instructions.

## Workspace Summary

The workspace endpoint returns:

- Home Project;
- Funding Plan;
- purchase price;
- verified buyer funds;
- funding needed;
- total planned funding;
- remaining gap;
- settlement readiness;
- next guided action.

## API

Base path:

```text
/api/financing
```

Endpoints:

```text
GET  /home-projects
POST /home-projects
GET  /home-projects/:homeProjectId
PUT  /home-projects/:homeProjectId
POST /home-projects/:homeProjectId/transition
GET  /home-projects/:homeProjectId/workspace

GET  /funding-plans
POST /funding-plans
GET  /funding-plans/:fundingPlanId
POST /funding-plans/:fundingPlanId/transition
```

## Control Rules

1. Financing is project-based.
2. Verified buyer funds and the remaining funding gap are explicit.
3. A Verified Snapshot and Verified Value Package are required before funding planning.
4. A Funding Plan must cover the full purchase price before review.
5. Customer approval is separate from plan preparation.
6. No automatic funding approval is permitted.
7. No automatic settlement is permitted.
8. Settlement requires committed sources and settlement instructions.
9. The final settlement reference closes the acquisition event.
10. Post-settlement obligations remain linked to their funding instruments.
11. The settled Home Project is prepared for conversion into an ongoing property Asset Account.

## Example

```text
Purchase Price:        $400,000
Verified Buyer Funds:   $80,000
Funding Needed:        $320,000

Funding Plan:
Buyer Funds             $80,000
Institution Financing  $320,000
Total Planned          $400,000
Remaining Gap                $0
```

The customer reviews and approves the plan before any commitment or settlement step occurs.
