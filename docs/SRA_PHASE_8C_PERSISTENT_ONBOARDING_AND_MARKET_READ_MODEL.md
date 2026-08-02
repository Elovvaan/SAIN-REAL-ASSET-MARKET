# SRA Phase 8C — Persistent Onboarding and Marketplace Read Model

## Purpose

Phase 8C moves onboarding applications, private evidence packages, institutional review records, and V4V package state into the persistent domain. It also makes the persistent domain the primary source for marketplace and Asset Studio reads.

## Persistent onboarding flow

```text
Private Documents
  -> Onboarding Application
  -> Evidence Package
  -> V4V Package
  -> Institutional Review
  -> Asset Account
  -> Lifecycle Events
```

The following record types are now persisted:

- `PARTICIPANT`
- `ONBOARDING_APPLICATION`
- `EVIDENCE_PACKAGE`
- `INSTITUTIONAL_REVIEW`
- `V4V_PACKAGE`
- `ASSET_ACCOUNT`
- `LIFECYCLE_EVENT`

## Marketplace read model

The seeded marketplace object is now used only to initialize an empty persistent domain. Once records exist, marketplace reads derive from persistent Asset Accounts, Project Accounts, Participation Positions, and lifecycle activity.

```text
Persistent Domain
  -> Marketplace Read Model
  -> Public Summary
  -> Authenticated Marketplace
  -> Asset Studio
```

The `/api/marketplace` response now comes from `PersistentMarketplaceService`.

## Asset Studio

`GET /api/assets/:assetId/studio` now assembles its response from persistent records:

- Asset Account
- Onboarding Application
- Evidence Package
- Institutional Review
- V4V Packages
- Project Accounts
- Market Signals
- Verified Market Events
- Lifecycle Events

## Startup behavior

```text
Initialize database
  -> Hydrate persistent records
  -> Seed Asset and Project records only when absent
  -> Initialize services from persistent state
  -> Serve persistent marketplace data
```

## Version

- Application version: `1.8.2`
- Phase: `8C_PERSISTENT_ONBOARDING_AND_MARKET_READ_MODEL`

## Remaining production work

- Durable object storage for uploaded file bytes
- Object-level authorization for evidence and review records
- Institutional review decision workflow
- Verified Value baseline creation after review
- Transaction boundaries across multi-record writes
- Database migrations with explicit schema versions
- Automated integration and restart-persistence tests
