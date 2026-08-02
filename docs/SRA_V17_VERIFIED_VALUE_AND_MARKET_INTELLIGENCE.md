# SRA V17 — Verified Value & Market Intelligence

## Governing Principle

> When you hit the ground, you hit Sane.

SRA must never confuse a market signal with verified reality.

## Three Complementary Layers

### 1. Verified Value

Answers: **What do we know is true now?**

Includes:

- verified asset identity;
- verified evidence;
- verified activity;
- verified revenue;
- verified cash flow;
- verified operating status;
- verified value record.

### 2. Market Intelligence

Answers: **What is the market signaling may happen?**

Includes:

- quoted price;
- potential sale price;
- potential rental income;
- potential return;
- potential gain or loss;
- market demand;
- market activity;
- participation interest;
- projected completion value.

Every Market Intelligence amount must remain explicitly labeled as quoted, projected, estimated, potential, expected, indicated, or not yet realized.

### 3. Verified Market Events

Answers: **What actually happened?**

Includes completed and evidenced events such as:

- sale closed;
- lease executed;
- payment received;
- revenue received;
- rent collected;
- settlement completed.

A completed event may establish:

- verified market price;
- verified income;
- verified gain;
- verified loss;
- updated Verified Value.

## Signal Graduation Rule

```text
PROPOSED
  -> QUOTED
  -> ACCEPTED
  -> EXECUTED
  -> EVIDENCED
  -> VERIFIED MARKET EVENT
```

Time, repetition, popularity, or market attention alone cannot turn a signal into Verified Value.

## Feedback Loop

```text
Verified Value Record
  -> Market Intelligence
  -> Completed Transaction or Collection
  -> Evidence Captured
  -> Verified Market Event
  -> Updated Verified Value Record
```

## API

```text
GET  /api/value-intelligence/summary
GET  /api/value-intelligence/assets/:assetId
POST /api/value-intelligence/signals
POST /api/value-intelligence/events/verify
```

## UI Language Contract

Verified fields may use labels such as:

- Verified Value
- Verified Revenue
- Verified Cash Flow
- Verified Market Price
- Verified Gain

Market Intelligence fields must use labels such as:

- Quoted Price
- Projected Completion Value
- Estimated Rental Income
- Potential Return
- Potential Gain
- Not Yet Realized

## Sane Language Contract

Sane must describe the grounded value first, then the signal, then the event.

Example before closing:

> The asset has a Verified Value of $735,000. The projected completion value is $842,000, indicating a potential gain of $107,000 if the expected event occurs.

Example after closing:

> The event completed at $815,000. That amount is now a Verified Market Event and has been recorded as the current verified market price.

## Prototype Boundary

The V17 implementation stores records in memory. Production use requires persistent storage, signed evidence, authorization, audit history, event reversal controls, and integration with the permanent Asset Account and Life Record.
