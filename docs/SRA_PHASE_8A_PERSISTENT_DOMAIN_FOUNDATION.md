# SRA Phase 8A — Persistent Domain Foundation

## Purpose

Phase 8 begins the transition from a functional architecture prototype into a persistent application. V1–V17 remain the product and domain architecture. Phase 8 supplies the production foundation required to retain identities, sessions, capabilities, evidence metadata, domain records, and audit events across deployments.

## Implemented in Phase 8A

### PostgreSQL foundation

SRA now detects Railway's `DATABASE_URL` and initializes PostgreSQL automatically. When no database is configured, the application remains runnable through an explicit in-memory fallback for local development.

### Persistent records

The initial schema includes:

- `sra_users`
- `sra_sessions`
- `sra_private_documents`
- `sra_domain_records`
- `sra_audit_events`

### Persistent access system

The following records now survive application restarts when PostgreSQL is configured:

- Universal identities and accounts
- password credential records
- account capabilities and lifecycle states
- active operating tier
- authenticated sessions

Raw session tokens are not stored in PostgreSQL. Only SHA-256 token hashes are retained.

### Persistent private-document metadata

Private evidence metadata now persists, including:

- document identity
- original file name and MIME type
- SHA-256 digest
- document classification
- uploader
- review state
- access state
- storage location

The document bytes still use the configured filesystem path. Railway production must attach a persistent Volume and set `SRA_PRIVATE_DOCUMENT_ROOT` to that mounted path, or a later object-storage adapter must replace filesystem storage.

### Audit foundation

Account creation, session lifecycle, workspace changes, capability applications, capability activations, and private-document storage now generate audit events.

## Railway configuration

Add a PostgreSQL service to the Railway project. Railway will provide `DATABASE_URL` automatically.

For durable private files:

1. Attach a Railway Volume to the web service.
2. Mount it at a path such as `/data/private-documents`.
3. Set:

```text
SRA_PRIVATE_DOCUMENT_ROOT=/data/private-documents
```

Without that variable, document bytes continue to use `/tmp/sra-private-documents` and are not durable.

## Health contract

`GET /api/health` now reports:

- Phase `8A_PERSISTENT_DOMAIN_FOUNDATION`
- persistence mode
- database readiness
- persistent identity state
- persistent session state
- persistent capability state
- document metadata persistence
- audit ledger state
- durable file-storage configuration

## Next Phase 8 work

Phase 8B should migrate the remaining runtime domain objects:

- asset onboarding applications
- Asset Accounts
- V4V packages
- projects and opportunities
- participation positions
- transferable positions
- creative-finance structures
- market signals
- verified market events
- lifecycle records

Phase 8C should add object-level authorization, durable workflow state, signed approvals, test coverage, and production monitoring.
