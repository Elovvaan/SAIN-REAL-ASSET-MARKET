# SAIN Real Asset Market (SRA)

SRA is a Verified Value marketplace for productive real-world assets.

This repository contains the first visual build used to see, test, and direct the platform before deeper implementation.

## First Build

The current prototype includes:

- Marketplace overview
- Productive project cards
- Permanent Asset Account view
- Live marketplace activity
- Verified Value indicators
- Completion Participant watch
- Sane conversational panel
- Railway-ready Node/Express service

The current data is representative prototype data. It is intentionally structured around the committed `SRA_MASTER_ARCHITECTURE.md` so the visual build remains connected to the official platform architecture.

## Current Architecture Phases

- Enterprise Data Exchange Phase 1
- Optional Settlement and Cross-Platform Routing
- Market Circulation Guardrail
- SRA On-Chain Projection Layer

The On-Chain Projection Layer is defined in:

`docs/architecture/sra-on-chain-projection-layer.md`

Its initial target is a controlled Solana representation of an existing SRA platform funding instrument. SRA remains the authoritative instrument, participant, ownership, Verified Value, settlement, and lifecycle system. The blockchain representation is downstream of the existing SRA instrument and must return through reconciliation.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Railway

The repository includes `railway.json` and uses the Railway-provided `PORT` environment variable.

1. Create a Railway project from this GitHub repository.
2. Railway will install dependencies through Nixpacks.
3. The service starts with `npm start`.
4. The health check is available at `/api/health`.

### Circle CCTP V2

Treasury Wallets includes a governed Circle CCTP V2 workflow for moving genuine USDC from Stellar to another configured CCTP network. It records authorization, Stellar approval and burn transactions, Circle attestation, destination mint, and reconciliation as separate persistent stages.

The integration defaults to testnet. Configure the following before enabling a destination:

```text
CIRCLE_CCTP_MODE=TESTNET
STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_DISTRIBUTOR_SECRET=...
CIRCLE_CCTP_API_URL=https://iris-api-sandbox.circle.com

CCTP_ETHEREUM_RPC_URL=...
CCTP_ETHEREUM_PRIVATE_KEY=...
CCTP_ETHEREUM_MESSAGE_TRANSMITTER=...
```

Replace `ETHEREUM` with another supported EVM destination name (`BASE`, `ARBITRUM`, `OPTIMISM`, `AVALANCHE`, or `POLYGON`) to configure that executor. Production additionally requires `CIRCLE_CCTP_MODE=PRODUCTION`, a production Stellar Soroban RPC URL, and Circle's current production MessageTransmitter address for each enabled destination. Solana remains unavailable in the action selector until its destination mint executor is configured; the platform does not represent an unavailable route as executable.

### SRAUSD / USDC conversion

The Instruments → On-Chain workstation can quote and execute a live Stellar strict-send path payment from an issued SRA asset into USDC. SRA stores the quote, explicit execution approval, confirmed transaction, and reconciled SRAUSD sold / USDC received amounts. The swap fails without live market liquidity and never manufactures or relabels USDC.

USDC identity follows `STELLAR_NETWORK`: the official public-network issuer is used for Mainnet and the official Testnet issuer is used for Testnet. `STELLAR_USDC_ISSUER` may override the issuer explicitly when required by the selected environment.

## Repository Rule

`SRA_MASTER_ARCHITECTURE.md` is the current architectural source of truth for SRA. The implementation should follow that document and should not redefine Verified Value or import unrelated architecture from outside the repository.

Supporting phase documents under `docs/architecture/` define approved implementation boundaries for their respective phases and must remain consistent with the master architecture.
