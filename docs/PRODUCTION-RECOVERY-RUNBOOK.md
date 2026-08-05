# SRA Production Recovery Runbook

## Purpose

This runbook governs production incidents, database recovery, connector failure, and controlled return to service for SAIN Real Asset Market.

## Severity

- **SEV-1:** data integrity risk, unauthorized access, incorrect ownership recognition, database unavailable, or settlement mismatch.
- **SEV-2:** major workflow unavailable, connector outage, sustained 5xx errors, or material queue blockage.
- **SEV-3:** degraded performance, isolated workflow errors, or noncritical integration failure.

## Immediate response

1. Record incident start time and request IDs.
2. Freeze affected write routes when integrity is uncertain.
3. Preserve logs, audit events, settlement confirmations, and connector references.
4. Do not manually alter ownership, settlement, issuance, or allocation records outside the controlled APIs.
5. Notify the designated incident owner through `SRA_ALERT_WEBHOOK_URL`.

## Database failure

1. Confirm `/api/production/dependencies` reports `DATABASE: FAIL`.
2. Stop customer writes or place Railway in maintenance mode.
3. Verify the latest backup manifest and SHA-256 checksum.
4. Restore only into a disposable database first:

```bash
SRA_RESTORE_DATABASE_URL=<disposable-db-url> npm run restore:verify -- backups/<backup>.dump
```

5. Compare counts for domain records, audit events, users, and sessions.
6. Run security, transaction-safety, settlement, and funding integration tests against the restored database.
7. Promote the restored database only after qualification passes.
8. Redeploy and confirm hydration, readiness, and sample record lineage.

## Settlement incident

1. Stop ownership recognition for the affected authorization.
2. Locate the settlement confirmation, provider reference, evidence hash, and transaction.
3. If payment was returned before ownership recognition, record a confirmation reversal.
4. If ownership was already recognized, freeze the position and escalate as SEV-1; do not silently rewrite history.
5. Reconcile external rail totals against SRA transactions and positions.

## Connector outage

1. Keep settlement authorizations in `AWAITING_CONFIRMATION`.
2. Do not substitute a staff-entered reference for connector evidence.
3. Retry only with the same idempotency key.
4. Confirm the connector secret has not rotated unexpectedly.
5. When restored, process provider confirmations and reconcile missed events.

## Application rollback

1. Identify the last known green commit.
2. Confirm no database migration is incompatible with rollback.
3. Redeploy the previous commit.
4. Verify `/api/health`, `/api/startup`, `/api/production/dependencies`, and `/api/production/readiness`.
5. Run the integration suite.

## Return-to-service gates

- Database dependency passes.
- Application startup passes.
- No unresolved SEV-1 event.
- Security, transaction-safety, and settlement tests pass.
- Restored records hydrate correctly.
- No unexplained settlement or ownership mismatch.
- Error rate and p95 latency return below configured thresholds.

## Required evidence

Retain the incident timeline, request IDs, logs, alert payloads, audit events, backup manifest, restore report, test results, affected record IDs, corrective action, and final authorization to return to service.
