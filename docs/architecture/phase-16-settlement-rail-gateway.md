# Phase 16 — Settlement Rail Gateway

## Purpose

Phase 16 connects SRA's settlement instrument and settlement record to external value-transfer channels without transferring ownership of the transaction workflow to the institution.

SRA remains the authoritative system for the instrument, allocation, settlement state, reconciliation, exception handling, and closeout. The connected institution provides an execution channel such as wire, Fedwire, ACH, internal transfer, or another approved rail.

## Core Flow

```text
SRA Settlement Instrument
-> Settlement Rail Instruction
-> Institution Rail Adapter
-> External Payment Channel
-> Institution / Network Confirmation
-> SRA Reconciliation
-> Settlement Closeout
```

## Separation of Objects

```text
Settlement Instrument = what is being settled
Settlement Rail Instruction = how an allocated amount is directed
External Rail = how value is transferred
Rail Confirmation = evidence returned by the channel
Reconciliation = SRA matching the instruction, amount, and evidence
```

The external rail does not replace or adjudicate the SRA instrument.

## Persistent Records

```text
SETTLEMENT_RAIL_ADAPTER
SETTLEMENT_RAIL_INSTRUCTION
```

## Supported Rail Types

```text
WIRE
FEDWIRE
ACH
INTERNAL_TRANSFER
OTHER_APPROVED_RAIL
```

These are adapter classifications. A registered adapter still requires an actual institution endpoint or integration reference before execution.

## Instruction Lifecycle

```text
READY
-> DISPATCHED
-> ACCEPTED
-> EXECUTED
-> RECONCILED
```

Exception outcomes:

```text
REJECTED
RETURNED
EXCEPTION
CANCELLED
```

## Instruction Fields

- instruction ID;
- settlement ID;
- settlement package ID;
- settlement instrument reference;
- Home Project ID;
- participation commitment ID, when applicable;
- institution and adapter IDs;
- rail type;
- amount and currency;
- sender account reference;
- receiving institution reference;
- receiving account reference;
- purpose;
- requested execution date;
- remittance reference;
- settlement package hash;
- message standard;
- instruction message hash.

## Controls

- The SRA settlement must be READY or LOCKED before instructions are created.
- The rail adapter must be active.
- A linked participation commitment must already be COMMITTED.
- Commitment institution and adapter institution must match.
- Instruction amounts cannot exceed the remaining settlement amount.
- Receiving accounts can be restricted by adapter configuration.
- Acceptance and later states require an institution transaction reference.
- Execution and reconciliation require a network reference.
- Reconciliation requires receiving-side confirmation.
- Confirmed amount must exactly match the instruction amount.
- Rejections, returns, and exceptions require an exception code.
- SRA does not treat dispatch as settlement completion.

## Reconciliation Status

For each settlement, the gateway reports:

- required amount;
- executed amount;
- reconciled amount;
- remaining amount to execute;
- remaining amount to reconcile;
- all-executed indicator;
- all-reconciled indicator;
- exception indicator.

## API

Base path:

```text
/api/settlement-rails
```

Endpoints:

```text
GET  /adapters
POST /adapters
GET  /adapters/:adapterId
GET  /instructions
POST /instructions
GET  /instructions/:instructionId
POST /instructions/:instructionId/transition
GET  /settlements/:settlementId/status
```

## Integration Boundary

This phase supplies the internal adapter and lifecycle contract. It does not claim a live Fedwire, bank API, master-account, or payment-network connection exists merely because an adapter record is registered. A real institution integration must authenticate, translate, transmit, and return genuine network evidence through its approved channel.
