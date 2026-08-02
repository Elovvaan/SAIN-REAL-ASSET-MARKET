# SRA MASTER_ARCHITECTURE.md

**Platform:** SRA (Sane Real Assets)\
**Purpose:** Master architecture for the SRA repository only.

> This document defines the architecture of SRA. It is **not** the
> master architecture of Verified Value. SRA inherits the Verified Value
> philosophy but maintains its own architecture.

------------------------------------------------------------------------

# Relationship

    Verified Value
            │
            ├── Sane Finance
            │      └── MASTER_ARCHITECTURE.md
            │
            ├── SRA
            │      └── MASTER_ARCHITECTURE.md
            │
            └── Future Platforms
                   └── Their own MASTER_ARCHITECTURE.md

------------------------------------------------------------------------

# Core Philosophy

SRA is a Verified Value marketplace for productive real-world assets.

The Marketplace is the front door.

Verified Value is the engine.

Sane is the conversational intelligence.

------------------------------------------------------------------------

# Core Architecture

    Sane
        ↓
    Marketplace Engine
        ├── Asset Engine
        ├── Participant Engine
        └── Verified Value Engine
                ↓
           True Bill Engine

------------------------------------------------------------------------

# Marketplace Engine

Responsible for:

-   Projects
-   Jobs
-   Opportunities
-   Marketplace Pools
-   Scheduling
-   Matching
-   Public Registry

------------------------------------------------------------------------

# Asset Engine

Responsible for:

-   Permanent Asset Accounts
-   Lifecycle Records
-   Operational Status
-   Ownership History
-   Structural History

------------------------------------------------------------------------

# Participant Engine

Responsible for:

-   Unified Identity
-   Multi-role Participation
-   Permissions
-   Context

------------------------------------------------------------------------

# Verified Value Engine

Responsible for:

-   Lifecycle Evaluation
-   Verified Value Packages (VVP)
-   Multi-dimensional Verified Value
-   Eligibility Evaluation

Verified Value precedes any True Bill issuance.

------------------------------------------------------------------------

# True Bill Engine

Purpose-bound marketplace instruments linked to frozen Verified Value
Packages.

Lifecycle:

-   Draft
-   Issued
-   Active
-   Settled
-   Closed
-   Archived

------------------------------------------------------------------------

# Sane

Sane is the conversational operating layer.

It understands intent, resolves context, coordinates the engines, and
presents guided actions for user approval.

------------------------------------------------------------------------

# Public Registry

Provides privacy-safe views of marketplace activity through projection
policies while protecting private operational data.

------------------------------------------------------------------------

# Guiding Principles

1.  Verified Value is the parent philosophy.
2.  SRA implements Verified Value.
3.  Asset Accounts are permanent.
4.  Marketplace activity is conversational.
5.  The architecture guides implementation.

------------------------------------------------------------------------

# Current Status

The SRA architecture defines the Marketplace Engine, Asset Engine,
Participant Engine, Verified Value Engine, True Bill Engine, Sane
conversational layer, and Public Registry.

This document is the authoritative architectural reference for the SRA
repository.
