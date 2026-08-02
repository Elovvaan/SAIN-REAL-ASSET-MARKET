# SRA V18 — Optional Settlement and Cross-Platform Settlement

## Purpose

V18 defines settlement as an available participant choice after a verified marketplace outcome is completed.

Settlement is not automatically forced when a project, transaction, instrument, or participation outcome reaches completion. SRA records that settlement is available, presents the permitted paths, records the participant's instruction, and reconciles the selected result.

## Governing Principle

> Completion makes settlement available. The participant chooses whether to settle, hold, transfer, redeploy, or route the position through an approved cross-platform path.

SRA does not control the participant's later economic use after an authorized settlement, transfer, or withdrawal is completed. SRA preserves the authoritative marketplace record, the selected instruction, the execution evidence, and the reconciled position state.

## Core Flow

```text
Verified Marketplace Position
        ↓
Deployment and Active Participation
        ↓
Verified Transaction or Project Outcome
        ↓
OUTCOME_COMPLETED
        ↓
SETTLEMENT_AVAILABLE
        ├── SETTLE_NOW
        ├── HOLD_POSITION
        ├── TRANSFER_POSITION
        ├── REDEPLOY_IN_SRA
        └── ROUTE_CROSS_PLATFORM
        ↓
Execution Evidence
        ↓
Reconciliation
        ↓
Updated Position and Permanent Asset History
```

## Position Lifecycle

```text
AUTHORIZED
  -> PENDING_RECEIPT or CONTRIBUTION_V4V_REQUIRED
  -> RECEIVED
  -> DEPLOYED
  -> ACTIVE
  -> OUTCOME_COMPLETED
  -> SETTLEMENT_AVAILABLE
```

From `SETTLEMENT_AVAILABLE`, the holder may select one authorized path:

```text
SETTLEMENT_AVAILABLE
  -> HELD
  -> TRANSFER_PENDING
  -> REDEPLOYMENT_PENDING
  -> SETTLEMENT_PENDING
  -> CROSS_PLATFORM_ROUTING_PENDING
```

Resulting states may include:

```text
HELD
TRANSFERRED
REDEPLOYED
SETTLED
ROUTED_EXTERNALLY
RECONCILED
CLOSED
```

A position does not close merely because settlement became available. Closure occurs only after the chosen path is completed, reconciled, and no remaining position or unresolved instruction remains.

## Settlement Instruction

Every participant choice creates a Settlement Instruction containing:

- instruction identifier;
- participant account identifier;
- position identifier;
- project and asset references;
- exact position version relied upon;
- available settlement amount or non-cash position state;
- selected action;
- selected settlement medium or routing path where applicable;
- destination account, wallet, platform, or position reference where applicable;
- authorization reference;
- restrictions and conditions;
- creation time;
- execution state;
- completion evidence references;
- reconciliation event reference.

Settlement Instructions are durable records. A changed instruction creates a new instruction or authorized amendment; it does not silently overwrite completed history.

## Settlement Choices

### Settle Now

The participant elects to complete settlement through an available SRA settlement rail.

Available rails may include:

- SRA settlement balance;
- SRA settlement coin;
- stable digital asset;
- cryptocurrency;
- bank or institutional settlement rail;
- approved custody rail;
- approved external settlement adapter.

### Hold Position

The participant retains the completed position without immediate settlement. The position remains visible in the participant account with its current rights, restrictions, value state, settlement availability, and lifecycle history.

### Transfer Position

The participant initiates an authorized assignment or transfer under the Transferable Position architecture. The original position history, current holder, new holder, retained value, transferred value, and settlement routing remain preserved.

### Redeploy in SRA

The participant applies an eligible completed position or settlement capacity toward another SRA opportunity, project, pool, instrument, or contribution structure. Redeployment creates a new linked participation record rather than erasing the prior completed position.

### Route Cross-Platform

The participant routes an eligible settlement position to another approved platform or rail. SRA records the outbound instruction and confirmation while preserving SRA as the authoritative source for the original marketplace position.

## SRA Settlement Coin

The SRA settlement coin is an optional settlement medium. It is not:

- the underlying real-world asset;
- the Verified Value Package;
- the participation position;
- the True Bill;
- the Public Recognition Framework;
- or a mandatory condition of marketplace participation.

Its role is:

> To provide an optional digital medium for settling recognized SRA transactions and eligible cross-platform transactions.

The coin may be selected only after a settlement instruction exists and the position is eligible for the selected route.

## Cross-Platform Settlement

```text
SRA Position
      ↓
Outcome Completed
      ↓
Settlement Available
      ↓
Participant Selects Cross-Platform Route
      ↓
Destination Platform and Account Resolved
      ↓
Settlement Medium Selected
      ↓
Outbound Settlement Instruction
      ↓
Destination Confirmation
      ↓
Cross-Platform Reconciliation
      ↓
SRA Position Updated
```

Cross-platform settlement must preserve:

- source platform;
- destination platform;
- source position and version;
- participant authority;
- settlement medium;
- amount or position state;
- conversion or translation terms where applicable;
- outbound event;
- destination confirmation;
- final reconciliation state.

## Platform Boundaries

1. SRA makes settlement available after a verified outcome.
2. The participant selects the next authorized path.
3. SRA does not force settlement merely because an outcome is complete.
4. The settlement coin is optional.
5. SRA remains authoritative for the original SRA position and its history.
6. A destination platform remains authoritative for the destination-side record it creates.
7. Cross-platform movement requires linked confirmations from both sides.
8. Settlement, transfer, redeployment, and external routing remain distinct events.
9. No position closes with an unresolved amount, instruction, transfer, or reconciliation variance.
10. Completed settlement does not give SRA control over the participant's later use outside the recorded SRA workflow.

## Sane Responsibilities

Sane may:

- explain that settlement is available;
- display the participant's eligible choices;
- compare settlement rails and routing paths;
- prepare the Settlement Instruction;
- request participant authorization;
- monitor execution status;
- surface missing confirmations or unresolved variances;
- and present the reconciled result.

Sane may not:

- select a settlement path without participant authorization;
- force conversion into the SRA settlement coin;
- silently transfer or redeploy a position;
- represent an external route as complete before confirmation;
- or close a position before reconciliation.

## Status

Architecture identifier: `SRA-V18`

Status: Established
