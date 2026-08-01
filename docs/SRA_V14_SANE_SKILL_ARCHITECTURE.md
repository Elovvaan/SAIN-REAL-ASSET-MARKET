# SRA V14 — Sane Skill Architecture

## Core Rule

Sane is one agent with many skills.

The agent does not become a different identity when it moves between Marketplace, V4V, Asset, Participation, Project, True Bill, Settlement, Discharge, or Completion work. It selects the skill or combination of skills needed to accomplish the stated outcome.

```text
User Goal
    ↓
Sane
    ↓
Understand Intent
    ↓
Read Active Operating Tier
    ↓
Select Authorized Skills
    ↓
Build Execution Plan
    ↓
Call Domain Services
    ↓
Combine Results
    ↓
Respond
```

## Skill Registry

V14 introduces a formal registry for:

- Identity Skill
- Marketplace Skill
- V4V Skill
- Asset Skill
- Participation Skill
- Project Skill
- True Bill Skill
- Settlement Skill
- Discharge Skill
- Completion Skill

Each skill declares:

- its stable identifier;
- human-readable label;
- operating purpose;
- permitted operating tiers;
- intent signals used by the dispatcher.

## Operating-Tier Boundary

The active operating tier determines which skills are available.

### Universal

- Identity
- Marketplace
- Participation
- Settlement

### Asset Provider

- Identity
- Marketplace
- V4V
- Asset
- Project
- True Bill
- Completion

### Market Professional

- Identity
- Marketplace
- Participation
- Project
- Settlement

### Institutional Operator

- Identity
- Marketplace
- V4V
- Asset
- Participation
- Project
- True Bill
- Settlement
- Discharge
- Completion

### Platform Administration

- Identity
- Marketplace

Platform Administration remains limited to SRA platform administration and is not used to import parent-platform workflows into this build.

## Multi-Skill Planning

Sane may combine skills into a single execution plan.

Example: remodel a restaurant.

```text
Asset Skill
    ↓
V4V Skill
    ↓
Project Skill
    ↓
Marketplace Skill
    ↓
Participation Skill
```

Example: complete a stalled project.

```text
Completion Skill
    ↓
Project Skill
    ↓
Participation Skill
    ↓
Settlement Skill
    ↓
Discharge Skill
```

The user experiences one conversation. The internal plan remains structured and auditable.

## API Boundary

```text
GET  /api/sane/skills?operatingTier=UNIVERSAL
POST /api/sane/message
```

Message request:

```json
{
  "message": "Help complete this project and close the position.",
  "operatingTier": "INSTITUTIONAL_OPERATOR"
}
```

Message response:

```json
{
  "agent": "SANE",
  "architectureVersion": "V14",
  "operatingTier": "INSTITUTIONAL_OPERATOR",
  "selectedSkills": ["COMPLETION", "PROJECT", "PARTICIPATION", "SETTLEMENT", "DISCHARGE"],
  "executionPlan": [],
  "reply": "..."
}
```

## Product Experience

The Sane panel displays the selected skill plan after a request. This is a product-development view that makes the architecture visible while SRA is being shaped. Production disclosure can later be reduced so ordinary users see outcomes while institutional operators retain deeper routing and audit information.

## V14 Boundary

V14 establishes skill discovery and execution planning. The current skills return structured plans and contextual responses. Direct write execution against every underlying domain service, approvals, durable workflow state, rollback, and full audit persistence remain subsequent production layers.
