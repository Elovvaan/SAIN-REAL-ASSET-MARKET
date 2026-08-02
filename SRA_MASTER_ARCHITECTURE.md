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
           Instrument Catalog
                ↓
           Instrument Series
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
-   Instrument discovery
-   Active instrument-series views

------------------------------------------------------------------------

# Asset Engine

Responsible for:

-   Permanent Asset Accounts
-   Lifecycle Records
-   Operational Status
-   Ownership History
-   Structural History
-   Instrument-series relationships

------------------------------------------------------------------------

# Participant Engine

Responsible for:

-   Unified Identity
-   Multi-role Participation
-   Permissions
-   Context
-   Participation Positions
-   Transferable Positions

------------------------------------------------------------------------

# Verified Value Engine

Responsible for:

-   Lifecycle Evaluation
-   Verified Value Packages (VVP)
-   Multi-dimensional Verified Value
-   Eligibility Evaluation

Verified Value precedes any SRA instrument-series issuance.

------------------------------------------------------------------------

# Instrument Catalog

The Instrument Catalog defines SRA-native instrument families.

An instrument family is a reusable marketplace structure that establishes:

-   family identity
-   purpose
-   supported asset classifications
-   permitted purposes
-   lifecycle
-   current catalog status

Instrument families do not replace Permanent Asset Accounts, Verified Value Packages, projects, True Bills, Participation Positions, or Transferable Positions. They organize how those existing SRA records may be expressed through multiple purpose-built instrument versions.

Initial families include:

-   Completion Instruments
-   Expansion Instruments
-   Production Instruments

Additional families may be introduced through the same catalog without changing the underlying SRA flow.

------------------------------------------------------------------------

# Instrument Series

An Instrument Series is the asset-specific and purpose-specific version of an instrument family.

Every series must reference:

-   one Instrument Family
-   one Permanent Asset Account
-   one frozen Verified Value Package
-   a defined purpose
-   its own Series ID

A series may also reference:

-   a Project Account
-   one or more True Bills
-   Participation Positions
-   Transferable Positions
-   market events
-   restrictions and conditions
-   external identifiers

Lifecycle:

-   Draft
-   Issued
-   Active
-   Suspended
-   Settled
-   Closed
-   Archived

Every state change is written to the Lifecycle Event Ledger and Audit Ledger.

------------------------------------------------------------------------

# True Bill Engine

Purpose-bound marketplace instruments linked to frozen Verified Value Packages.

Within the expanded instrument architecture, a True Bill remains an SRA-native issuance form and may be linked to an Instrument Series. It is not removed, renamed, or replaced.

Lifecycle:

-   Draft
-   Issued
-   Active
-   Settled
-   Closed
-   Archived

------------------------------------------------------------------------

# Instrument Flow

    Permanent Asset Account
            ↓
    Verified Value Package
            ↓
    Instrument Family selected
            ↓
    Instrument Series created
            ↓
    True Bill and/or market position linked
            ↓
    Participation Position
            ↓
    Transferable Position
            ↓
    Verified Market Events
            ↓
    Lifecycle Event Ledger
            ↓
    Updated Permanent Asset Account view

The flow returns all instrument activity to the asset record. This is the SRA expression of the infinity design: asset evidence and Verified Value support instrument activity, and completed instrument activity returns to the permanent asset history.

------------------------------------------------------------------------

# Sane

Sane is the conversational operating layer.

It understands intent, resolves context, coordinates the engines, and
presents guided actions for user approval.

Sane may guide catalog selection, series creation, lifecycle transitions, participation, transfer, and instrument workspace review without bypassing the underlying SRA records.

------------------------------------------------------------------------

# Public Registry

Provides privacy-safe views of marketplace activity through projection
policies while protecting private operational data.

The Public Registry may display approved Instrument Family and Instrument Series fields, identifiers, lifecycle state, asset relationship, market status, and verified market events according to projection policy.

------------------------------------------------------------------------

# Guiding Principles

1.  Verified Value is the parent philosophy.
2.  SRA implements Verified Value.
3.  Asset Accounts are permanent.
4.  Marketplace activity is conversational.
5.  The architecture guides implementation.
6.  Instrument families organize reusable SRA-native structures.
7.  Instrument series preserve asset-specific purpose, identity, and lifecycle.
8.  Instrument activity returns to the Permanent Asset Account and lifecycle history.

------------------------------------------------------------------------

# Current Status

The SRA architecture defines the Marketplace Engine, Asset Engine,
Participant Engine, Verified Value Engine, Instrument Catalog, Instrument
Series, True Bill Engine, Sane conversational layer, and Public Registry.

The current implementation includes persistent Instrument Family and Instrument Series records, instrument APIs, series workspaces, lifecycle transitions, and Asset Studio series relationships.

This document is the authoritative architectural reference for the SRA
repository.
