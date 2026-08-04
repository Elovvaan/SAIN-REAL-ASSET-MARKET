# SRA Version 3 — Phase 2: SAIN Recognition Engine

Phase 2 operates on persistent `MARKET_OBSERVATION` records created by the Observation Layer.

## Recognition chain

```text
Observation
→ Identity
→ Source
→ Authority
→ Evidence
→ Classification
→ Relationships
→ Measurement
→ Recognition decision
```

SAIN records this chain as a persistent `RECOGNITION_ASSESSMENT`.

## Recognition assessment

Each assessment preserves:

- the observed record and original payload digest;
- the identity of the subject being recognized;
- the source market and source record identity;
- the authority basis and scope used by SRA;
- supporting evidence references;
- classification and category;
- relationships to other records, subjects, or market classes;
- the measurement method, unit, value, inputs, and as-of time;
- the recognition decision, rationale, limitations, actor, and timestamp;
- a deterministic recognition digest.

## Decisions

- `RECOGNIZED`
- `IN_REVIEW`
- `REJECTED`

The current observation points to the latest assessment through `currentRecognitionId` and records its `recognitionState`.

## API

```text
POST /api/observations/:observationId/recognize
GET  /api/observations/recognitions
GET  /api/observations/recognitions/:recognitionId
GET  /api/observations/:observationId
GET  /api/observations/summary
```

## Phase boundary

Phase 2 establishes the recognized position and its recorded reasoning. It does not yet:

- create the Phase 3 financial record;
- allocate or mint the Phase 4 coin representation;
- create an instrument;
- post ledger entries;
- settle or publish a transaction.

Those operations consume the recognition assessment in later locked phases.
