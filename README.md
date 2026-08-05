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

## Repository Rule

`SRA_MASTER_ARCHITECTURE.md` is the current architectural source of truth for SRA. The implementation should follow that document and should not redefine Verified Value or import unrelated architecture from outside the repository.

Supporting phase documents under `docs/architecture/` define approved implementation boundaries for their respective phases and must remain consistent with the master architecture.
