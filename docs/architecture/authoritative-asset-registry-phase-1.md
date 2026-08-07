# SRA Authoritative Asset Registry — Phase 1

## Purpose

This layer makes the current SRA asset, position, custody, instrument, and settlement objects operate against one authoritative financial state.

It does not replace `AssetAccount`, `LifecycleRecord`, `VerifiedValuePackage`, `TrueBill`, `ParticipationPosition`, `CustodyRecord`, or `SettlementInstruction`.

It controls how relationships and transferable capacity are recognized around those objects.

## Core objects

### AssetRelationship

Represents a recognized relationship between a participant and an asset, instrument, or position.

Supported Phase 1 relationships:

- `OWNS`
- `BENEFICIAL_OWNER_OF`
- `REGISTERED_HOLDER_OF`
- `CONTROLS`
- `CUSTODIAN_OF`
- `SECURED_PARTY_OF`
- `SERVICES`
- `NOMINEE_FOR`

Every relationship requires an authority reference. Evidence, restrictions, priority, effective dates, and expiration may also be recorded.

### PositionReservation

Temporarily prevents recognized transferable position capacity from being reused while a transfer, settlement, pledge, or other controlled action is pending.

A reservation does not transfer ownership. It reserves capacity until the action completes, fails, expires, or is released.

### AssetStateSnapshot

Produces a point-in-time calculated view of:

- recognized value;
- transferable capacity;
- allocated amount;
- reserved amount;
- encumbered amount;
- available capacity;
- active relationships;
- restrictions;
- asset version.

The snapshot is a derived state view. The underlying lifecycle record and authoritative objects remain the record source.

## Control rules

Phase 1 enforces:

1. optimistic version checks before relationship registration or position reservation;
2. rejection of conflicting exclusive ownership;
3. rejection of conflicting exclusive custody;
4. express support for non-exclusive custody;
5. rejection of position reservations exceeding current transferable capacity;
6. linkage of accepted registry operations to lifecycle events;
7. deterministic conflict codes for administrative explanations and API responses.

## Conflict codes

- `EXCLUSIVE_OWNER_CONFLICT`
- `EXCLUSIVE_CUSTODY_CONFLICT`
- `RESERVATION_POSITION_MISMATCH`
- `INSUFFICIENT_TRANSFERABLE_CAPACITY`
- `STALE_ASSET_VERSION`
- `STALE_POSITION_VERSION`

## Required repository interfaces

The registry service works against repository interfaces rather than a specific database implementation.

### Asset repository

- `getById(assetId)`

### Relationship repository

- `save(relationship)`
- `listByAssetId(assetId)`

### Reservation repository

- `save(reservation)`
- `listByPositionId(positionId)`
- `listByAssetId(assetId)`

### Lifecycle repository

- `getById(lifecycleRecordId)`
- `getByAssetId(assetId)`
- `save(lifecycleRecord)`

### Position repository

- `getById(positionId)`

## Settlement integration boundary

Before an external settlement adapter is invoked, the settlement workflow must:

1. load the current participation position;
2. verify the expected position version;
3. verify actor authority and active relationship state;
4. calculate available transferable capacity;
5. create a position reservation tied to the settlement instruction;
6. append the reservation lifecycle event;
7. only then create an external execution order.

When execution fails or is cancelled, the reservation must be released.

When execution is confirmed and reconciled, the reservation must be consumed into the resulting position and ownership state update.

## Phase 2

The next layer should add durable database repositories, application services, administrative explanation responses, and API endpoints for:

- registering and closing asset relationships;
- creating and releasing position reservations;
- reading authoritative asset state snapshots;
- checking transfer and settlement eligibility;
- exposing conflict reasons without exposing internal implementation details.
