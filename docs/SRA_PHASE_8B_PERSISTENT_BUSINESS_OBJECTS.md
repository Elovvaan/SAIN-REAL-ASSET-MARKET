# SRA Phase 8B — Persistent Business Objects

## Purpose

Phase 8B moves the platform's active business records out of process-local Maps and into the shared persistent domain layer established in Phase 8A.

## Persisted Record Types

- Asset Accounts
- Project Accounts
- V4V packages reserved by the domain model
- Participation positions
- Transferable positions
- Creative-finance structures
- Verified Value records
- Market signals
- Verified Market Events
- Lifecycle events

All records use the `sra_domain_records` table with a stable record type and record identifier. PostgreSQL is used when `DATABASE_URL` is present. The local memory fallback remains available for development but is not durable.

## Startup Flow

```text
Database initialize
  -> Persistent domain hydrate
  -> Seed Asset Accounts and Project Accounts only when absent
  -> Initialize transferable positions
  -> Initialize Verified Value records and market signals
  -> Start API service
```

Existing PostgreSQL records take precedence over prototype seed data. A restart or Railway redeployment no longer clears migrated business objects.

## Lifecycle and Audit Recording

Important record changes now write both:

1. the current domain record; and
2. an append-style lifecycle or audit event.

Examples include:

- participation position authorized;
- transferable position created or assigned;
- creative-finance structure created, reconciled, settled, or discharged;
- market signal created or graduated;
- Verified Market Event recorded;
- Verified Value updated from an evidenced market event.

## Persistent Service Boundaries

### Participation

New positions are persisted as `PARTICIPATION_POSITION` records and remain available after restart.

### Creative Finance

Transferable positions and creative-finance structures are persisted. Partial assignments update the source position and create a separate assigned position.

### Value Intelligence

Verified Value records, market signals, and Verified Market Events are persisted. A signal may update Verified Value only through the evidenced market-event path.

## Health Reporting

`GET /api/health` reports phase `8B_PERSISTENT_BUSINESS_OBJECTS`, persistence mode, domain record counts, and the migrated object groups.

`GET /api/domain` returns both the older visual prototype snapshot and the persistent domain summary during the transition period.

## Remaining Phase 8 Work

- Persist onboarding applications and generated V4V packages from the legacy domain store.
- Make the persistent domain—not the seeded marketplace object—the primary source for public and authenticated marketplace reads.
- Add object-level authorization to every write route.
- Replace request-supplied actor identifiers with authenticated session identity.
- Add durable object storage for private document bytes.
- Add database migrations, constraints, transaction boundaries, backups, and automated tests.
