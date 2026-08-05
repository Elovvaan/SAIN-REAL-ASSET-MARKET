# SRA Hybrid Liquidity Market

## Purpose

The Hybrid Liquidity Market adds continuous price-discovery structures around verified SRA instruments without changing the underlying asset record.

The underlying instrument remains the source of rights, obligations, ownership, restrictions, and evidence lineage. A hybrid market definition is a separate market-layer record.

## Supported market modes

- `SPOT` — direct governed participation in a published SRA instrument.
- `CONTINUOUS_REFERENCE` — continuously updated reference value for an instrument that may not trade frequently.
- `EVENT_REFERENCE` — price discovery around a defined, externally resolvable event.
- `PERPETUAL_REFERENCE` — non-expiring reference market tied to a verified index.

## First production boundary

The first implementation is deliberately reference-only:

- no leverage;
- no liquidations;
- no funding payments;
- no participant order execution;
- no settlement instruction creation;
- no physical delivery;
- no change to the underlying SRA instrument.

This creates the market identity, index methodology, source requirements, event-resolution terms, reference observations, and administrative approval record before execution is enabled.

## Record flow

```text
Verified SRA Instrument
        ↓
Hybrid Market Definition
        ↓
Approved Reference Methodology
        ↓
Reference Observations
        ↓
Continuous Mark / Event Probability / Perpetual Reference
```

A later execution phase must add separate controls for collateral, margin, position limits, participant eligibility, funding, liquidation, settlement, dispute resolution, and market surveillance.

## API contract

The router exposes:

- `GET /status`
- `GET /markets`
- `GET /markets/:marketId`
- `POST /preview`
- `POST /approve`
- `POST /references`

The router is intentionally separate so it can be mounted behind the platform's existing authorization middleware after administrative review.
