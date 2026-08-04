# SRA OpenAI Agent Integration

## Purpose

This integration replaces the marketplace's canned SAIN response path with an OpenAI-powered SANE operating agent that reads the existing `OPENAI_API_KEY` from the Railway runtime environment.

```text
Marketplace Chat UI
-> POST /api/sane/agent/chat
-> SraAgentService
-> Authorized SRA Context
-> OpenAI Responses API
-> Grounded SANE Reply
```

## Runtime Configuration

The application reads:

```text
OPENAI_API_KEY
OPENAI_MODEL (optional)
```

The API key remains in Railway. It is not stored in GitHub, returned by an endpoint, logged by the application, or transmitted to the browser.

## Agent Context

The chat request can include a limited scope describing the current workspace and any specific records needed for the answer.

Supported context includes:

```text
Marketplace assets and projects
Domain record counts
Ledger account balance
Trial balance
Platform treasury position
Financial statements
Asset servicing summary
Institution billing summary
Home Project
Settlement
Requested persistent record
```

Marketplace context is included by default. Additional financial context must be requested through scope identifiers.

## Read and Write Boundary

The chat endpoint is read-only.

```text
writeAccess: DISABLED
approvalRequiredForStateChanges: true
```

SANE may explain, summarize, compare, identify missing evidence, and prepare the next step. It does not directly change ledger, treasury, settlement, servicing, billing, publishing, or offering states through the chat endpoint.

## API

```text
GET  /api/sane/agent/status
POST /api/sane/agent/chat
```

Example request:

```json
{
  "message": "Compare the current projects.",
  "scope": {
    "activeView": "marketplace",
    "operatingTier": "UNIVERSAL",
    "includeMarketplace": true
  }
}
```

## Frontend

The marketplace composer now calls `/api/sane/agent/chat` rather than `/api/sane/message`. The old skill endpoint remains available for compatibility, but it is no longer the primary marketplace conversation path.

## Safety and Accuracy

The system instruction requires SANE to:

- use only provided SRA context;
- distinguish recorded facts from calculations and interpretations;
- avoid inventing approvals, balances, settlement completion, eligibility, or legal authority;
- identify missing evidence explicitly;
- require a separate approved workflow for state-changing actions.
