# Coinbase Transaction Asset Pipeline

## Purpose

The Coinbase public market connector records market-wide trades as SRA Market Observations. This pipeline advances eligible Coinbase trade observations through SRA's existing recognition, digital financial-asset, Coin Position, and instrument layers.

```text
Coinbase public market activity
→ Market Observation
→ SAIN Recognition Assessment
→ Financial Record
→ SRA Coin Position
→ Consolidated SRA Position Contract
```

Individual trades remain source and evidence records. The consolidated product Coin Position forms one SRA Position Contract that inherits the rights, obligations, restrictions, and lineage already recorded on the Financial Record and Coin Position.

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

When contract formation is enabled, the consolidated Coin Position is formalized through the existing `InstrumentEngineService` as an `SRA_POSITION_CONTRACT` with purpose `SRA_COIN_POSITION_EXECUTION`.

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

The position contract is recorded as active for the SRA Living Market and ready for network selection. Its documentary package remains the source of authority; on-chain code executes that recorded authority after a network is selected.

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

With contract formation enabled, the operational boundary is `SRA_POSITION_CONTRACT`. The contract formalizes the consolidated SRA Coin Position while preserving every Coinbase observation, recognition, Financial Record, Coin Position, ownership record, and source-evidence lineage behind it.

The pipeline does not automatically publish an offering, execute an SRA marketplace transaction, transfer ownership to a customer, service a payment, or settle consideration. Those continue through their existing platform workflows.
