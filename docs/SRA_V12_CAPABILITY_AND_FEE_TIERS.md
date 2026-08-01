# SRA V12 — Capability & Fee Tier Architecture

## Governing rule

One identity. One free Universal Account. Additional paid or authorized capabilities expand what the account can do without creating another login.

## Capability tiers

### Universal Account

- Tier: FREE
- Activation: automatic at signup
- Purpose: browse, watch, participate in eligible opportunities, track positions, receive settlement, and use Sane.

### Asset Provider

- Tier: PAID
- Activation: application and review
- Fee basis: V4V intake, verification, listing, and project-related fees.
- Unlocks: V4V Exchange, private evidence intake, Asset Accounts, Verified Value, project creation, opportunity publishing, and completion tools.

### Market Professional

- Tier: PAID
- Activation: application and review
- Fee basis: subscription, credential review, matching, and transaction fees.
- Unlocks: professional profile, capacity management, proposals, assignments, contribution positions, and settlement tools.

### Institutional Operator

- Tier: AGREEMENT
- Activation: institutional approval
- Unlocks: V4V review, custody, institutional records, settlement, setoff, discharge, audit, and administration.

### Platform Administration

- Tier: INTERNAL
- Activation: internal authorization
- Unlocks: SRA Platform Account, parent-platform connection, treasury, platform funding, interplatform reporting, and administration.

## Capability lifecycle

NOT_ADDED → APPLICATION_STARTED → INFORMATION_REQUIRED → UNDER_REVIEW → ACTIVE → SUSPENDED or CLOSED

The Universal Account is always created as ACTIVE and FREE.

## Interface rule

Profiles display Capabilities rather than a single Account Type. Active capacities appear in the workspace switcher. Inactive capacities appear in the Capability workspace with their tier, fee basis, activation path, and current lifecycle state.

## Prototype limitation

V12 represents fee bases and application states but does not yet collect fees, verify credentials, persist accounts in a database, or perform real institutional approvals. Those are later production layers.
