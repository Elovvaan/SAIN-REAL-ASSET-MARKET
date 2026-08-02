# SRA Enterprise Data Exchange — Phase 12 Enterprise SDK

## Purpose

Phase 12 exposes the EDX platform as a developer integration layer so businesses and software providers can connect directly to SRA.

It provides:

- REST APIs;
- webhook subscription contracts;
- persistent event-stream feeds;
- secure client authentication;
- standard record schemas;
- a machine-readable milestone ledger.

## Enterprise SDK Records

- `EDX_SDK_CLIENT`;
- `EDX_WEBHOOK_SUBSCRIPTION`;
- `EDX_EVENT_STREAM_SUBSCRIPTION`;
- `EDX_OUTBOUND_EVENT`.

## Secure Authentication

Each SDK client belongs to one enterprise and receives:

- an SDK client ID;
- a one-time client secret;
- enterprise-scoped permissions;
- explicit scopes;
- allowed origins;
- a rate-limit setting.

The client secret is returned once. Only its SHA-256 hash is persisted.

Client states:

```text
ACTIVE
SUSPENDED
REVOKED
```

## REST API

Base path:

```text
/api/edx/sdk
```

Endpoints:

```text
GET  /schemas
GET  /milestones

GET  /clients
POST /clients
POST /clients/authenticate
POST /clients/:sdkClientId/transition

GET  /webhooks
POST /webhooks
POST /webhooks/:webhookSubscriptionId/transition

POST /event-streams
POST /event-streams/:eventStreamSubscriptionId/transition

GET  /events
POST /events
```

## Webhooks

Webhook subscriptions record:

- enterprise and SDK client;
- endpoint URL;
- subscribed event types;
- active state;
- HMAC-SHA256 signing contract;
- a one-time signing secret;
- delivery timestamps.

This phase creates the secure registration and event-delivery contract. A later deployment worker may perform outbound HTTP delivery and retries.

## Event Streaming

Event-stream subscriptions support an enterprise-scoped persistent event feed.

Default protocol:

```text
SERVER_SENT_EVENTS
```

Consumers retrieve events using enterprise, event type, and cursor-time filters. Events are immutable and ordered by occurrence time.

## Standard Event Types

```text
EDX.EXTRACTION.COMPLETED
EDX.NORMALIZATION.COMPLETED
EDX.SNAPSHOT.COMPLETE
EDX.VALUE_PACKAGE.ACTIVE
EDX.PUBLICATION.APPROVED
EDX.MARKETPLACE.PUBLISHED
EDX.INTELLIGENCE.READY
```

## Standard Record Schemas

The SDK publishes schema definitions for:

- canonical normalized records;
- Verified Snapshots;
- Verified Value Packages;
- outbound events.

The schemas expose required fields, standard categories, standard metrics, schema versions, and value-field conventions.

## Milestone Ledger

The SDK milestone endpoint separates implementation completion from live-data completion.

Statuses:

```text
COMPLETE
IMPLEMENTED_AWAITING_LIVE_RUN
```

A milestone that requires live business data is not marked complete merely because its engine exists. It becomes complete after the corresponding persistent runtime record exists.

## Success Milestones

### Milestone 1 — EDX architecture approved

Status: `COMPLETE`

Evidence: Phase 1 architecture and master architecture integration are merged.

### Milestone 2 — First connector working

Status is determined at runtime.

- `COMPLETE` when at least one persistent extraction result exists;
- otherwise `IMPLEMENTED_AWAITING_LIVE_RUN`.

The custom API and structured-payload extraction contracts are implemented.

### Milestone 3 — Permission engine complete

Status: `COMPLETE`

Evidence: persistent extraction policies and machine-readable authorization evaluation are active.

### Milestone 4 — Verified Snapshot generated automatically

Status is determined at runtime.

- `COMPLETE` when a persistent Verified Snapshot exists;
- otherwise `IMPLEMENTED_AWAITING_LIVE_RUN`.

### Milestone 5 — Verified Value Package created from live business data

Status is determined at runtime.

- `COMPLETE` when a persistent Verified Value Package exists;
- otherwise `IMPLEMENTED_AWAITING_LIVE_RUN`.

### Milestone 6 — Marketplace publishing operational

Status: `COMPLETE`

Evidence: company-controlled publication decisions, approval, execution, projections, and withdrawal are implemented.

### Milestone 7 — Sane guides businesses through the workflow

Status: `COMPLETE`

Evidence: Sane can review the latest package, explain the operating results, and record Publish Today or Keep Private while leaving approval and execution with the company.

## Protection Rules

1. Every SDK client is enterprise-scoped.
2. Client secrets and webhook signing secrets are returned once and stored only as hashes.
3. Suspended and revoked clients cannot authenticate.
4. Webhooks and event streams subscribe only to recognized event types.
5. Outbound events identify their enterprise.
6. Event feeds do not combine private records across enterprises.
7. SDK access does not bypass extraction-policy permissions.
8. SDK access does not bypass publication approval.
9. Webhook registration does not automatically publish company data.
10. Live-data milestones remain pending until persistent runtime evidence exists.

## Phase 12 Exit Criteria

Phase 12 is complete when:

- SDK clients can be created, authenticated, suspended, and revoked;
- standard schemas are available through the REST API;
- webhook subscriptions can be registered and controlled;
- event-stream subscriptions can be registered and controlled;
- enterprise-scoped events can be persisted and queried;
- the milestone ledger accurately distinguishes implemented capabilities from successful live runs;
- the live server reports the Enterprise SDK as active.
