# SRA V10 — Marketplace Participation Layer

V10 introduces the transaction path between browsing a productive opportunity and holding an active participation position.

## Primary flow

Browse Marketplace
→ Open Opportunity
→ Review Verified Value Summary
→ Participate
→ Choose Position
→ Choose Contribution Medium
→ Review Ticket
→ Authorize
→ Position Created
→ Contribution Verification
→ Deployment
→ Active Participation
→ Outcome Completion
→ Settlement Available
→ Participant Choice
→ Reconciliation
→ Closure When Applicable

## Participation types

- Capital
- Service
- Material
- Equipment
- Contract

## Contribution media

- USD
- Bank transfer
- Stable digital asset
- Cryptocurrency
- Existing SRA balance
- Equipment
- Material
- Service
- Contract right

## Contribution verification

Cash-like media enter receipt verification. Non-cash external contributions enter a focused Contribution V4V before deployment.

## Position lifecycle

```text
AUTHORIZED
→ PENDING_RECEIPT or CONTRIBUTION_V4V_REQUIRED
→ RECEIVED
→ DEPLOYED
→ ACTIVE
→ OUTCOME_COMPLETED
→ SETTLEMENT_AVAILABLE
```

Settlement availability does not force immediate settlement or automatic closure.

From `SETTLEMENT_AVAILABLE`, the participant may choose:

```text
SETTLE_NOW
HOLD_POSITION
TRANSFER_POSITION
REDEPLOY_IN_SRA
ROUTE_CROSS_PLATFORM
```

The selected choice moves the position into the corresponding operating state:

```text
HELD
TRANSFER_PENDING
REDEPLOYMENT_PENDING
SETTLEMENT_PENDING
CROSS_PLATFORM_ROUTING_PENDING
```

Completed outcomes may include:

```text
TRANSFERRED
REDEPLOYED
SETTLED
ROUTED_EXTERNALLY
RECONCILED
CLOSED
```

A position closes only after the selected path is completed, reconciled, and no remaining position or unresolved instruction remains.

## Settlement availability

A completed transaction or project outcome creates a settlement-availability event for the eligible participant position.

SRA then presents the participant's authorized choices. SRA does not automatically convert, transfer, redeem, settle, or close the position.

Every choice produces a durable Settlement Instruction identifying the participant, position, selected path, authorization, settlement medium or destination where applicable, execution state, evidence, and reconciliation event.

The authoritative optional-settlement architecture is defined in:

`docs/SRA_V18_OPTIONAL_SETTLEMENT_AND_CROSS_PLATFORM.md`

## Interface layers

1. Compact scrollable marketplace cards
2. Clickable opportunity workspace
3. Participation ticket
4. Position-created confirmation
5. My Positions portfolio
6. Outcome-completed and settlement-available notice
7. Settlement-choice workspace
8. Settlement, holding, transfer, redeployment, or cross-platform status
9. Institutional settlement, setoff, discharge, custody, and filing remain behind authorized operations

## Prototype scope

Positions are held in memory for this build. External payment processing, custody of digital assets, document signing, persistent accounts, persistent positions, contribution valuation, settlement rails, settlement-coin execution, and cross-platform confirmation require later production infrastructure.
