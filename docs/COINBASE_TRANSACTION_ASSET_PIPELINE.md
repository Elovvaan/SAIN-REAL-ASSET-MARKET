# Coinbase Transaction Asset Pipeline

## Purpose

The Coinbase public market connector records market-wide trades as SRA Market Observations. This pipeline advances eligible Coinbase trade observations through SRA's existing recognition, digital financial-asset, Coin Position, and instrument layers.

```text
Coinbase public market trade
→ Market Observation
→ SAIN Recognition Assessment
→ Financial Record
→ SRA Coin Position
→ SRA Instrument
```

The SRA Instrument is the obligation-bearing record for this production route. It inherits the rights, obligations, restrictions, and source lineage already recorded on the Financial Record and Coin Position instead of creating a parallel obligation system.

## Recognition basis

Each trade preserves:

- Coinbase product and trade ID
- executed price and size
- transaction notional
- trade side and source timestamp
- connector ID and source reference
- raw Coinbase payload and payload digest

The Recognition Assessment classifies the recorded event as a `VERIFIED_MARKET_TRANSACTION` and measures its source transaction notional in USD.

## Financial-asset record

A recognized trade becomes a `MARKET_TRANSACTION_FINANCIAL_ASSET` Financial Record. The record keeps its source amount, authority, evidence, rights, obligations, restrictions, and complete lineage.

The public trade feed does not identify an underlying Coinbase customer. SRA therefore records the subject as the Coinbase market product, such as `COINBASE:BTC-USD`, and explicitly retains the limitation that no underlying customer identity or account ownership is inferred.

## SRA Coin representation

Each eligible Financial Record is represented as an SRA Coin Position using the recorded rule:

```text
source transaction notional × 1 SRA per recorded USD = SRA Coin quantity
```

The result is a platform-recognized digital financial asset under the SRA Coin rules. Trading is not required for the Coin Position to exist as an SRA financial asset.

The original source amount, current Verified Value, offered price, and any executed SRA marketplace trade price remain separate records.

The Coin Position is initially owned by `SRA_PLATFORM` under the platform ownership rules. Later ownership changes remain separate lifecycle events so the origin owner and current owner can both be reconstructed.

## Instrument and obligation convergence

When instrument formation is enabled, the same Coin Position is formalized through the existing `InstrumentEngineService` as an `SRA_VALUE_INSTRUMENT` with purpose `RECORDED_MARKET_TRANSACTION_OBLIGATION`.

The instrument carries forward the Coin Position's existing rights and obligations, including:

- `SOURCE_TRACEABILITY_OBLIGATION`
- `VALUE_SEPARATION_OBLIGATION`

It also carries the source restrictions and Coinbase lineage. No second Coin Position, second ledger, or separate obligation engine is created.

The relationship is bidirectional:

```text
SRA Coin Position.instrumentId
↔
SRA Instrument.coinPositionId
```

That allows the platform to traverse backward from the instrument to the Coinbase observation and forward from the Coin Position into the common instrument lifecycle used by other SRA production routes.

Newly formed Coinbase-backed instruments are recorded in `RECORDED` state. Their transfer, activation, servicing, settlement, or other later lifecycle actions remain governed by the existing SRA workflows.

## Existing observations

At application startup, the pipeline backfills previously recorded Coinbase Market Observations. New Coinbase trades enter the same pipeline immediately after Observation Layer recording.

Processing is idempotent. Reprocessing the same observation reuses its existing Recognition Assessment, Financial Record, Coin Position, and open SRA Instrument rather than creating duplicates. The same pass also repairs a missing Coin Position-to-Instrument backlink when an instrument already exists.

## Runtime controls

The pipeline is enabled by default while the Coinbase connector is active. It can be disabled explicitly:

```text
COINBASE_TRANSACTION_ASSET_PIPELINE_ENABLED=false
```

Automatic instrument formation is also enabled by default and can be disabled independently:

```text
COINBASE_TRANSACTION_INSTRUMENT_FORMATION_ENABLED=false
```

When instrument formation is disabled, the pipeline continues to stop at the existing SRA Coin Position boundary.

The maximum number of existing observations processed during startup backfill can be configured:

```text
COINBASE_TRANSACTION_ASSET_BACKFILL_LIMIT=5000
```

## Boundary

With instrument formation enabled, the pipeline boundary is `SRA_INSTRUMENT`. The instrument formalizes the existing SRA Coin Position as an obligation-bearing SRA record while preserving the complete Coinbase observation, recognition, Financial Record, Coin Position, ownership, and source-evidence lineage.

The pipeline does not automatically publish an offering, execute an SRA marketplace transaction, transfer ownership to a customer, service a payment, or settle consideration. Those continue through their existing platform workflows.