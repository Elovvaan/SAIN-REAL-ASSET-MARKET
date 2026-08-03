# Phase 13 — Home Project Workspace

## Purpose

Phase 13 exposes the Home Project financing workflow through the live SRA user interface.

The customer can:

- create a Home Project;
- see purchase price, verified buyer funds, and funding need;
- open one project workspace;
- review progress and Sane guidance;
- inspect Verified Snapshot and Verified Value Package references;
- inspect the Funding Plan and remaining gap;
- see documents and participants;
- inspect settlement readiness;
- review the project activity timeline.

## UI Flow

```text
SRA Navigation
-> Home Projects
-> Create or Open Project
-> Home Project Workspace
```

## Workspace Sections

```text
Overview
Verified Snapshot
Funding Plan
Documents
Participants
Settlement
Activity
```

## Customer Control

The UI does not automatically:

- approve a Funding Plan;
- commit a funding source;
- mark a project settlement ready;
- settle a transaction;
- publish a package.

It reads and writes through the existing controlled financing APIs.

## Progress

Progress is derived from the Home Project and Funding Plan states. It is an operating indicator, not a legal or institutional approval.

## Sane Guidance

The interface translates the current backend `nextAction` into plain-language guidance such as:

- begin data collection;
- generate the verified package;
- create a Funding Plan;
- cover a remaining funding gap;
- request customer approval;
- commit funding sources;
- add settlement instructions;
- proceed to settlement;
- convert the settled property into an Asset Account.

## Production Boundary

The UI uses:

```text
GET  /api/financing/home-projects
POST /api/financing/home-projects
GET  /api/financing/home-projects/:homeProjectId/workspace
POST /api/financing/home-projects/:homeProjectId/transition
```

The remaining funding and settlement lifecycle continues through the Funding Plan APIs introduced with the financing workspace.
