# Coinbase Transaction Asset Pipeline

## Purpose

The Coinbase public market connector records market-wide trades as SRA Market Observations. This pipeline advances eligible Coinbase trade observations through SRA's existing recognition and digital financial-asset layers.

```text
Coinbase public market trade
→ Market Observation
→ SAIN Recognition Assessment
→ Financial Record
→ SRA Coin Position
```

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

## Existing observations

At application startup, the pipeline backfills previously recorded Coinbase Market Observations. New Coinbase trades enter the same pipeline immediately after Observation Layer recording.

Processing is idempotent. Reprocessing the same observation returns its existing Recognition Assessment, Financial Record, and Coin Position rather than creating duplicates.

## Runtime controls

The pipeline is enabled by default while the Coinbase connector is active. It can be disabled explicitly:

```text
COINBASE_TRANSACTION_ASSET_PIPELINE_ENABLED=false
```

The maximum number of existing observations processed during startup backfill can be configured:

```text
COINBASE_TRANSACTION_ASSET_BACKFILL_LIMIT=5000
```

## Boundary

This pipeline creates the recognized Financial Record and SRA Coin Position. It does not automatically create a separate instrument, publish an offering, execute an SRA transaction, transfer ownership, or settle consideration. Those remain separate platform workflows.
