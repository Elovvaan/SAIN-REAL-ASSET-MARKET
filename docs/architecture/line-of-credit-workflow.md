# Line of Credit Within the Unified Financing Workflow

A line of credit is a financing product inside SRA's existing authoritative financing lifecycle. It is not an independent workflow.

## Authoritative lifecycle

```text
APPLICATION
-> UNDERWRITING
-> DECISION
-> CLOSING
-> READY_TO_FUND
-> FUNDED
-> SERVICING
-> CLOSED
```

`FUNDING_OPPORTUNITY.financingStage` remains authoritative and only `FinancingLifecycleService` may advance it.

## Opportunity type

```text
LINE_OF_CREDIT
```

For a line of credit, `requestedAmount` is the requested facility limit. The amount is supplied by the financing request and is never hard-coded.

## Facility state

The funding opportunity carries a subordinate `creditFacility` record containing:

```text
requestedLimit
approvedLimit
outstandingPrincipal
availableCredit
status
openedAt
draws[]
repayments[]
```

The facility record describes the revolving position but does not replace the financing lifecycle.

## Decision

At the DECISION stage, an approved amount becomes the facility's approved limit.

```text
approvedLimit = approved financing amount
outstandingPrincipal = 0
availableCredit = approvedLimit
```

A declined financing decision marks the facility declined and advances the authoritative financing lifecycle to CLOSED.

## Draws

A settled draw may be recorded only after closing has reached READY_TO_FUND, or while the facility is already FUNDED or SERVICING.

Every recorded draw requires:

```text
amount > 0
amount <= availableCredit
settlementReference
```

A settled draw changes the revolving position:

```text
outstandingPrincipal += draw amount
availableCredit -= draw amount
```

The first settled draw recorded from READY_TO_FUND advances the authoritative financing lifecycle to FUNDED. Later draws do not create a new financing workflow or reset the financing lifecycle.

## Repayments

A settled repayment may be recorded from FUNDED or SERVICING.

Every recorded repayment requires:

```text
amount > 0
amount <= outstandingPrincipal
settlementReference
```

A settled repayment restores availability up to the approved limit:

```text
outstandingPrincipal -= repayment amount
availableCredit = min(approvedLimit, availableCredit + repayment amount)
```

## Settlement boundary

The line-of-credit endpoints record a draw or repayment only when a settlement reference is supplied. They do not claim that merely requesting a draw moved money. External payment execution, reconciliation, account restrictions, and settlement evidence remain governed by the existing settlement and treasury controls.

## Admin workflow

The Unified Market Operations financing intake exposes Line of Credit as an opportunity type. The same admin financing record is used for application, evidence, underwriting, decision, closing, funding, and servicing. When a line-of-credit record is eligible, the opportunity detail view exposes settled draw and repayment recording controls and displays approved limit, outstanding principal, remaining availability, and activity history.
