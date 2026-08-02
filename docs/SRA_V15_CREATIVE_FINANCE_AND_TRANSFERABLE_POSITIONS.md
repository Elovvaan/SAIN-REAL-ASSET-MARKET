# SRA V15 — Creative Finance Skill & Transferable Position Architecture

## Mission

Enable Sane to identify existing verified value, measure a productive project gap, assemble multiple contribution media, transfer recognized positions, reconcile every movement, preserve settlement and discharge sequencing, and support participant-directed action after an outcome is complete.

## Governing Flow

```text
Verified Value
  -> Identify Available Positions
  -> Identify Project Gap
  -> Assemble Contributions
  -> Authorize Execution
  -> Deploy
  -> Reconcile
  -> Complete Outcome
  -> Make Settlement Available
  -> Participant Selects Hold, Transfer, Redeploy, Settle, or Cross-Platform Route
  -> Reconcile Selected Result
  -> Discharge Where Applicable
```

## New Sane Skills

### Creative Finance Skill

Coordinates Asset, V4V, True Bill, Assignment, Participation, Project, Completion, Settlement, and Discharge skills into one execution structure.

### Assignment Skill

Records all or part of a recognized SRA position moving from a current holder to a new holder while preserving retained value, custody reference, assignment reference, and settlement routing.

### Settlement Choice Skill

Presents the authorized choices available after a verified outcome is completed, prepares the selected Settlement Instruction, requests participant authorization, and coordinates execution and reconciliation.

The available choices are:

- Hold Position
- Transfer Position
- Redeploy in SRA
- Settle Now
- Route Cross-Platform

The skill may not select a path on the participant's behalf.

## Recognized Contribution Media

- USD
- Bank transfer
- Stable digital asset
- Cryptocurrency
- Verified asset
- True Bill
- Service
- Equipment
- Material
- Contract right
- Payment right
- Future production
- Completion capacity
- Existing SRA position

## Recognized Settlement Media

- Existing SRA settlement balance
- SRA settlement coin
- Stable digital asset
- Cryptocurrency
- Bank or institutional settlement rail
- Approved custody rail
- Approved external or cross-platform settlement adapter

The settlement medium is selected after settlement becomes available. It does not replace the underlying participation position or the Verified Value record.

## Transferable Position Record

A transferable position records:

- project;
- source type;
- current holder;
- previous holder;
- stated value;
- verified value;
- transferable value;
- assigned value;
- retained value;
- custody reference;
- settlement availability;
- settlement routing;
- settlement instruction reference;
- assignment reference;
- redeployment reference;
- cross-platform destination reference;
- lifecycle state.

## Creative Finance Structure

The structure compares project need with selected transferable positions and external contributions.

```text
Project Need
  - Transferable Positions
  - External Contributions
  = Remaining Gap
```

The output is either `READY_FOR_REVIEW` or `GAP_REMAINS`.

## Reconciliation Sequence

```text
Opening Need
  - Transfers
  - Contributions
  - Credits
  - Setoff
  - Settlement
  = Remaining Position
```

A structure cannot be recorded as fully settled while a remaining position is open. Discharge cannot be recorded before the applicable settlement event.

A completed marketplace outcome may still produce an open participant position when the participant chooses to hold, transfer, redeploy, or route the position instead of settling immediately.

```text
Outcome Completed
  -> Settlement Available
  -> Participant Choice
  -> Execution
  -> Reconciliation
  -> Updated Position State
```

## Optional Settlement Boundary

Settlement availability is not settlement completion.

SRA must preserve the distinction between:

- outcome completion;
- settlement availability;
- participant instruction;
- transfer or redeployment;
- settlement execution;
- destination confirmation;
- reconciliation;
- closure.

The authoritative optional-settlement architecture is defined in:

`docs/SRA_V18_OPTIONAL_SETTLEMENT_AND_CROSS_PLATFORM.md`

## API

```text
GET  /api/creative-finance/configuration
GET  /api/creative-finance/positions
POST /api/creative-finance/positions
POST /api/creative-finance/positions/:positionId/assign
POST /api/creative-finance/positions/:positionId/settlement-instructions
POST /api/creative-finance/positions/:positionId/hold
POST /api/creative-finance/positions/:positionId/redeploy
POST /api/creative-finance/positions/:positionId/route-cross-platform
POST /api/creative-finance/structures
POST /api/creative-finance/structures/:structureId/reconcile
POST /api/creative-finance/structures/:structureId/settle
POST /api/creative-finance/structures/:structureId/discharge
```

## Prototype Boundary

The current V15 implementation is an in-memory architecture prototype. It does not execute external payments, custody, legal assignments, tax accounting, third-party settlement, settlement-coin transfers, or cross-platform confirmation. Production deployment requires persistent storage, authentication-derived actor identity, object-level authorization, signed records, actual payment and custody integrations, audit logs, destination-platform confirmation, and jurisdiction-specific review.
