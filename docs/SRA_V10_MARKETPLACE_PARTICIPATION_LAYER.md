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
→ Settlement
→ Closure

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

AUTHORIZED
→ PENDING_RECEIPT or CONTRIBUTION_V4V_REQUIRED
→ RECEIVED
→ DEPLOYED
→ ACTIVE
→ SETTLEMENT_PENDING
→ SETTLED
→ CLOSED

## Interface layers

1. Compact scrollable marketplace cards
2. Clickable opportunity workspace
3. Participation ticket
4. Position-created confirmation
5. My Positions portfolio
6. Institutional settlement, setoff, discharge, custody, and filing remain behind authorized operations

## Prototype scope

Positions are held in memory for this build. External payment processing, custody of digital assets, document signing, persistent accounts, persistent positions, contribution valuation, and settlement rails require later production infrastructure.
