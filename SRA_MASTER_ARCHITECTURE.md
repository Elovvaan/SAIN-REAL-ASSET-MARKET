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
        ├── Enterprise Data Exchange
        ├── Asset Engine
        ├── Participant Engine
        ├── Market Circulation Guardrail
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

# Enterprise Data Exchange

The Enterprise Data Exchange (EDX) allows companies to connect approved source systems, authorize specific records and fields, normalize approved records into SRA record types, and prepare Verified Snapshots for the existing Verified Value Package workflow.

EDX is read-first and permission-driven.

EDX does not create general access to a company's systems and does not automatically publish company information.

Core flow:

    Company Source Systems
            ↓
    Company Authorization
            ↓
    Approved Record Extraction
            ↓
    Data Minimization
            ↓
    Normalization and Provenance
            ↓
    Verification
            ↓
    Verified Snapshot
            ↓
    Company Approval
            ↓
    Verified Value Package Handoff
            ↓
    Private, Institutional, Marketplace, or Public Projection

EDX responsibilities include:

-   Connector Registry
-   Enterprise Connections
-   Connection Authorization
-   Extraction Policies
-   Field-Level Data Minimization
-   Normalized Record Contracts
-   Provenance and Evidence References
-   Verified Snapshot Preparation
-   VVP Handoff
-   Projection and Publication Policies
-   Audit and Lifecycle Events

Visibility levels:

-   Private
-   Internal
-   Institutional
-   Marketplace
-   Public

Connecting a system does not authorize marketplace or public publication. Publication requires a separate company approval.

The authoritative Phase 1 EDX architecture is defined in:

`docs/architecture/enterprise-data-exchange-phase-1.md`

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

Verified Value precedes any True Bill or protection-instrument activation.

EDX prepares approved normalized records and Verified Snapshots for the Verified Value Engine. EDX does not independently determine final marketplace eligibility.

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

# Market Circulation Guardrail

The Market Circulation Guardrail protects the SRA marketplace when large movements create verified pressure across assets, projects, True Bills, Participation Positions, or Transferable Positions.

It does not introduce Family Capital instrument families or generic certificate series.

The guardrail classifies SRA market events including:

-   capital repatriation
-   market discharge
-   refinancing withdrawal
-   liquidity migration
-   currency reclassification
-   jurisdictional redeployment
-   settlement concentration
-   forced liquidation pressure
-   productive-capacity transition

The guardrail separates:

-   quoted repricing
-   completed ownership transfers
-   actual settlement outflow
-   unmatched liquidity pressure
-   verified productive-value change
-   unresolved variance

A headline market movement is not automatically the amount of the protection instrument. The instrument is tied to the verified transition requirement.

------------------------------------------------------------------------

# SRA Protection Instruments

When a Market Circulation Event is verified, classified, measured, and crosses its threshold, SRA may activate a temporary purpose-bound protection instrument.

Examples include:

-   Market Discharge Instrument
-   Capital Transition Instrument
-   Repatriation Transition Instrument
-   Recovery Instrument
-   Infrastructure Continuity Instrument
-   Emergency Liquidity Instrument

Every protection instrument must identify:

-   the triggering Market Circulation Event
-   affected Permanent Asset Accounts
-   affected Project Accounts
-   affected True Bills
-   affected Participation Positions
-   affected Transferable Positions
-   currencies and jurisdictions
-   verified transition requirement
-   purpose and scope
-   completion conditions
-   activation, reconciliation, and closing events

Protection instruments are temporary operating instruments. They do not replace Permanent Asset Accounts, Verified Value Packages, True Bills, Participation Positions, or Transferable Positions.

------------------------------------------------------------------------

# Infinity Circulation Flow

    DETECT
        ↓
    VERIFY
        ↓
    CLASSIFY
        ↓
    MEASURE
        ↓
    ACTIVATE
        ↓
    REDIRECT
        ↓
    REPURPOSE
        ↓
    SETTLE
        ↓
    RECONCILE
        ↓
    VERIFY

The SRA-specific record flow is:

    Market Circulation Event
            ↓
    affected Permanent Asset Accounts and Projects
            ↓
    affected True Bills and Positions
            ↓
    verified transition requirement
            ↓
    Protection Instrument
            ↓
    redirected participation, transfer, discharge, or completion
            ↓
    Verified Market Events
            ↓
    Lifecycle Event Ledger
            ↓
    updated Permanent Asset Accounts

Value movement returns to the permanent asset history after reconciliation.

------------------------------------------------------------------------

# Sane

Sane is the conversational operating layer.

It understands intent, resolves context, coordinates the engines, and
presents guided actions for user approval.

For EDX, Sane may explain connections, prepare extraction requests, display approved and excluded fields, summarize results, prepare Verified Snapshots, request company approval, prepare the VVP handoff, and present publication choices.

Sane may not silently expand source scopes, extract unapproved fields, publish automatically, or override company revocation.

Sane may also guide Market Circulation Event review, affected-record resolution, threshold evaluation, protection activation, redirection, settlement, and reconciliation.

------------------------------------------------------------------------

# Public Registry

Provides privacy-safe views of marketplace activity through projection
policies while protecting private operational data.

EDX source records remain private unless a separate projection policy and company approval authorize specific fields or calculated outputs for institutional, marketplace, or public use.

Approved Market Circulation Event and Protection Instrument states may be projected without exposing private evidence, positions, or institutional instructions.

------------------------------------------------------------------------

# Guiding Principles

1.  Verified Value is the parent philosophy.
2.  SRA implements Verified Value.
3.  Asset Accounts are permanent.
4.  Marketplace activity is conversational.
5.  The architecture guides implementation.
6.  EDX extracts only company-authorized records and fields.
7.  Connecting a source does not authorize publication.
8.  Private source data and projected marketplace data remain separate.
9.  Market movement is classified before a protection instrument is activated.
10. Protection capacity is tied to the verified transition requirement.
11. Every protection event returns to the asset and lifecycle records through reconciliation.
12. SRA retains its own instruments and does not import Family Capital architecture.

------------------------------------------------------------------------

# Current Status

The SRA architecture defines the Marketplace Engine, Enterprise Data Exchange, Asset Engine, Participant Engine, Verified Value Engine, True Bill Engine, Market Circulation Guardrail, Sane conversational layer, and Public Registry.

EDX Phase 1 defines the connector architecture, permission and visibility model, normalized record contract, security boundaries, audit vocabulary, Verified Snapshot lifecycle, and VVP handoff.

The Market Circulation implementation includes persistent Market Circulation Event and Protection Instrument records plus the activation service and API router.

This document is the authoritative architectural reference for the SRA
repository.
