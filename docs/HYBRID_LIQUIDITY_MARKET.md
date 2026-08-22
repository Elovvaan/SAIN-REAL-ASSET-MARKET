# SRA Hybrid Liquidity Market

## Purpose

The Hybrid Liquidity Market adds price-discovery structures around verified SRA instruments without changing the underlying asset record.

The underlying instrument remains the source of rights, obligations, ownership, restrictions, and evidence lineage. A hybrid market definition is a separate market-layer record inside the SRA Marketplace Engine.

## Supported market modes

- `SPOT` — direct governed participation in a published SRA instrument through the existing Marketplace Engine.
- `CONTINUOUS_REFERENCE` — continuously updated reference value for an instrument that may not trade frequently.
- `EVENT_REFERENCE` — price discovery around a defined, externally resolvable event.
- `PERPETUAL_REFERENCE` — non-expiring reference market tied to a verified index.

## Production boundary

Reference observations remain non-executable in every mode. A Hybrid reference value cannot replace a marketplace listing price, create a settlement instruction, move a balance, transfer ownership, or execute a trade.

The current governed execution handoff is limited to `SPOT`:

1. the Hybrid market must be administratively approved;
2. the same underlying SRA instrument must already have a LIVE marketplace listing;
3. the Hybrid market exposes that listing as its governed marketplace access point;
4. participant activity enters the existing Participant Order Intent workflow;
5. order review, matching, allocation, settlement, and ownership transfer continue through the existing SRA market workflow.

No separate Hybrid matching engine, settlement engine, balance system, or ownership system is created.

The following remain disabled inside the Hybrid layer:

- leverage;
- liquidations;
- funding payments;
- direct execution of reference observations;
- physical delivery;
- automatic settlement instruction creation;
- changes to the underlying SRA instrument.

`CONTINUOUS_REFERENCE`, `EVENT_REFERENCE`, and `PERPETUAL_REFERENCE` remain reference-only until their required controls exist. Perpetual or leveraged execution requires separate collateral, margin, position-limit, funding, liquidation, dispute-resolution, settlement, and market-surveillance controls.

## Record flows

Reference flow:

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

Governed SPOT handoff:

```text
Verified SRA Instrument
        ↓
Approved SPOT Hybrid Market
        ↓
LIVE Marketplace Listing
        ↓
Participant Order Intent
        ↓
Order Review / Matching
        ↓
Allocation
        ↓
Existing SRA Settlement Workflow
        ↓
Ownership / Position Update
        ↓
Transaction Market
```

The executable price authority remains the LIVE marketplace listing. Hybrid reference observations are carried as non-executable lineage so later transaction records can show which reference market informed the participant view without confusing a signal with an executed price.

## API contract

The Hybrid routes expose:

- `GET /status`
- `GET /markets`
- `GET /markets/:marketId`
- `POST /preview`
- `POST /approve`
- `POST /references`

Hybrid market reads now include `latestReference` and `marketplaceAccess`. For an eligible SPOT market, `marketplaceAccess` identifies the existing LIVE marketplace listing and the existing order-intent endpoints.

Participant orders continue to use the established endpoints:

- `POST /api/sane/order-intents/preview`
- `POST /api/sane/order-intents/confirm`

Confirmed order intents preserve Hybrid SPOT market and reference identifiers as lineage while retaining `MARKETPLACE_LISTING` as the pricing authority.
