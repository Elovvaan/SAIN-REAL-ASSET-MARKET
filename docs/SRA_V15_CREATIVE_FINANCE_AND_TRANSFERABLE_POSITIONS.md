# SRA V15 — Creative Finance Skill & Transferable Position Architecture

## Mission

Enable Sane to identify existing verified value, measure a productive project gap, assemble multiple contribution media, transfer recognized positions, reconcile every movement, and preserve settlement and discharge sequencing.

## Governing Flow

```text
Verified Value
  -> Identify Available Positions
  -> Identify Project Gap
  -> Assemble Contributions
  -> Authorize Execution
  -> Deploy
  -> Reconcile
  -> Settle
  -> Discharge Where Applicable
```

## New Sane Skills

### Creative Finance Skill

Coordinates Asset, V4V, True Bill, Assignment, Participation, Project, Completion, Settlement, and Discharge skills into one execution structure.

### Assignment Skill

Records all or part of a recognized SRA position moving from a current holder to a new holder while preserving retained value, custody reference, assignment reference, and settlement routing.

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
- settlement routing;
- assignment reference;
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

Settlement cannot be recorded while a remaining position is open. Discharge cannot be recorded before settlement.

## API

```text
GET  /api/creative-finance/configuration
GET  /api/creative-finance/positions
POST /api/creative-finance/positions
POST /api/creative-finance/positions/:positionId/assign
POST /api/creative-finance/structures
POST /api/creative-finance/structures/:structureId/reconcile
POST /api/creative-finance/structures/:structureId/settle
POST /api/creative-finance/structures/:structureId/discharge
```

## Prototype Boundary

The current V15 implementation is an in-memory architecture prototype. It does not execute external payments, custody, legal assignments, tax accounting, or third-party settlement. Production deployment requires persistent storage, authentication-derived actor identity, object-level authorization, signed records, actual payment and custody integrations, audit logs, and jurisdiction-specific review.
