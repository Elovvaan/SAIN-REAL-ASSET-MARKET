# Phase 14 — SRA Settlement Engine

## Purpose

Phase 14 makes SRA the system that evaluates settlement readiness, freezes the transaction package, executes the settlement workflow, records the completed event, converts the Home Project into an Asset Account, and closes the acquisition lifecycle.

SRA does not ask connected institutions to underwrite or close the project. Their capital participation is already represented in the Funding Plan before settlement begins.

## Core Flow

```text
Verified Home Project
-> Settlement Readiness
-> Immutable Settlement Package
-> Settlement Lock
-> Explicit SRA Execution
-> Settlement Record
-> Asset Account
-> Home Project Closeout
```

## Readiness Evaluation

SRA evaluates:

- Home Project state is SETTLEMENT_READY;
- Verified Snapshot reference exists;
- Verified Value Package reference exists;
- Funding Plan exists;
- Funding Plan is SETTLEMENT_READY;
- funding gap is zero;
- customer approval reference exists;
- settlement instructions exist;
- property is identified;
- buyer is identified.

A failed readiness check blocks settlement preparation.

## Settlement Package

The prepared package is marked:

```text
IMMUTABLE_PREPARED_PACKAGE
```

It contains:

- Settlement ID;
- Home Project ID;
- Funding Plan ID;
- Snapshot ID;
- VVP ID;
- customer and enterprise references;
- property;
- purchase price;
- verified buyer funds;
- source allocations;
- settlement instructions;
- participants;
- documents;
- target closing date;
- package version;
- SHA-256 package hash.

## Settlement Lifecycle

```text
READY
-> LOCKED
-> EXECUTING
-> COMPLETED
```

Alternative terminal states:

```text
FAILED
CANCELLED
ARCHIVED
```

Execution is explicit. Automatic settlement remains disabled.

## Execution Outputs

Successful execution creates and links:

1. Active Asset Account;
2. Settled Funding Plan;
3. Settled Home Project;
4. Immutable Settlement Record;
5. Completed SRA Settlement;
6. Lifecycle events for preparation, lock, execution, asset creation, closeout, and completion.

## Permanent Settlement Record

The Settlement Record includes:

- Settlement Record ID;
- Settlement ID;
- Home Project ID;
- Funding Plan ID;
- Asset Account ID;
- property;
- purchase price;
- package hash;
- execution reference;
- settlement reference;
- recording reference;
- source allocations;
- participants;
- completion timestamp;
- SHA-256 record hash;
- immutable flag.

## API

Base path:

```text
/api/settlement
```

Endpoints:

```text
GET  /settlements
GET  /settlements/readiness/:homeProjectId
POST /settlements/prepare
GET  /settlements/:settlementId
GET  /settlements/:settlementId/events
POST /settlements/:settlementId/lock
POST /settlements/:settlementId/execute
POST /settlements/:settlementId/cancel
GET  /settlement-records
GET  /settlement-records/:settlementRecordId
```

## Control Boundary

- SRA owns readiness evaluation.
- SRA owns the settlement package.
- SRA owns the settlement lifecycle and closeout record.
- Connected institutions do not re-underwrite the project during settlement.
- Capital sources are already committed before settlement.
- Recording references are supplied by the applicable recording process.
- Execution remains explicit and auditable.
