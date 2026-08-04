# SRA Version 3 — Phase 3 Financial Record Layer

Phase 3 accepts only Phase 2 recognition assessments whose decision is `RECOGNIZED`.

## Flow

`MARKET_OBSERVATION → RECOGNITION_ASSESSMENT → FINANCIAL_RECORD_ACCOUNT → FINANCIAL_RECORD`

A financial record preserves the recognized subject, source lineage, authority, evidence, classification, relationships, measurement, rights, obligations, restrictions, state, and complete status history.

## Boundaries

Phase 3 records a recognized financial position inside an SRA financial record account. It does not allocate SRA Coin, mint a token, create an instrument, post a general-ledger entry, publish an offering, or execute a transaction. Those actions remain assigned to later Version 3 phases.

## API

- `POST /api/financial-records/from-recognition/:recognitionId`
- `GET /api/financial-records`
- `GET /api/financial-records/summary`
- `GET /api/financial-records/accounts`
- `GET /api/financial-records/accounts/:accountId`
- `GET /api/financial-records/:financialRecordId`
- `POST /api/financial-records/:financialRecordId/state`
