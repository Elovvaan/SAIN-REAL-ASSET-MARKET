# SRA Orca Executor Worker

This directory is a separately deployable Railway service for the `SRA_DEX_EXECUTOR_V1` contract emitted by the main SRA application.

It does not run inside the SRA core process. It holds the Solana signing key, creates the Orca Whirlpool, seeds the first full-range liquidity position, and returns the external Solana references to SRA.

## Railway service

Create a second Railway service from this repository and set its root directory to:

`external/orca-executor`

The package `start` command runs `node server.js`.

Required environment variables:

- `SOLANA_RPC_URL` — Solana RPC endpoint.
- `SOLANA_CLUSTER` — `devnet` or `mainnet`. Use `devnet` until the external DEX canary is complete.
- `SOLANA_PAYER_SECRET_KEY` — Solana signer bytes as a JSON integer array or base64. Keep this only in the executor service.
- `DEX_ORCA_EXECUTOR_TOKEN` — shared bearer credential used by SRA and the worker.
- `DATABASE_URL` or `EXECUTOR_DATABASE_URL` — PostgreSQL used only for durable execution/idempotency records.
- `PGSSLMODE=require` only when the selected PostgreSQL endpoint requires TLS.

Then set these variables on the main SRA service:

- `DEX_ORCA_EXECUTION_MODE=LIVE`
- `DEX_ORCA_EXECUTOR_ENDPOINT=https://<executor-service>/execute`
- `DEX_ORCA_EXECUTOR_TOKEN=<same shared bearer credential>`

## Contract

The worker only accepts:

- `contract: SRA_DEX_EXECUTOR_V1`
- `venue: ORCA_WHIRLPOOLS`
- `network: SOLANA`
- `action: CREATE_POOL_AND_SEED_LIQUIDITY`
- `Idempotency-Key: <dexExportId>`

The first executor version supports `FULL_RANGE` liquidity only.

For each request it:

1. validates the contract and idempotency key;
2. acquires a PostgreSQL advisory lock for the export ID;
3. resolves the real mint decimals from Solana;
4. canonicalizes Orca token ordering and inverts the initial price when required;
5. prepares the deterministic concentrated-liquidity pool address;
6. creates the pool if this request has not already created it;
7. opens the first full-range position with the supplied maximum token quantities;
8. persists the pool/position/transaction references;
9. returns the liquidity transaction signature and pool address to SRA.

The executor never changes SRA's Financial Record or recognized-value basis. `initialMarketPrice` is an external market initialization instruction and the returned observed price is reference-only.

## Health

`GET /health` returns readiness without exposing the bearer token or signer bytes.

## Security boundary

Do not put `SOLANA_PAYER_SECRET_KEY` in the main SRA application. The main application should know only the executor endpoint and bearer credential. Start with a dedicated devnet-funded signer and a dedicated executor database/schema before enabling mainnet.
