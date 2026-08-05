# SRA On-Chain Projection Layer

**Platform:** SRA (Sane Real Assets)  
**Phase:** On-Chain Projection  
**Initial external network:** Solana  
**Authority model:** SRA remains the authoritative instrument, participant, ownership, and lifecycle system unless a later approved architecture explicitly changes that rule.

---

# Purpose

The SRA On-Chain Projection Layer allows an already formed, verified, authorized, and active SRA instrument or position to be reflected on an approved blockchain rail without redesigning or replacing the underlying SRA instrument.

The layer does not create the commercial paper, platform funding instrument, True Bill, Participation Position, Verified Value Package, or Permanent Asset Account.

It projects an approved representation of an existing SRA record.

SRA creates and governs the authoritative financial relationship.

The blockchain provides an external representation, transfer rail, settlement rail, or public proof according to the selected projection class.

---

# Architectural Position

    Documented Financial Transaction
                ↓
    Verified Transaction Lifecycle
                ↓
    Verified Value Package
                ↓
    SRA Instrument or Participation Position
                ↓
    Issuance and Activation
                ↓
    On-Chain Projection Eligibility
                ↓
    SRA On-Chain Projection Layer
                ├── Evidence Projection
                ├── Controlled Representation
                └── Native Instrument Projection
                ↓
    Approved Blockchain Rail
                ↓
    Chain Event Observation
                ↓
    SRA Reconciliation
                ↓
    Updated Authoritative SRA Records

The initial implementation target is Solana.

The architecture remains network-aware but not network-dependent.

---

# First Principle

SRA does not place an unformed idea on-chain.

SRA projects only an existing SRA record that has passed the required transaction, evidence, provenance, verification, recognition, Verified Value, issuance, participant, and authorization controls.

The on-chain object is downstream of the authoritative SRA record.

---

# Projection Classes

## Class 1 — Evidence Projection

Purpose:

- prove that an SRA record existed at a defined time;
- publish an approved status, digest, identifier, or lifecycle event;
- preserve a public or institutional verification reference;
- avoid transferring financial rights through the blockchain object itself.

The blockchain record does not independently convey ownership, repayment, transfer, participation, or settlement rights.

Examples:

- instrument existence proof;
- issuance event proof;
- document package digest;
- maturity event proof;
- settlement completion proof;
- lifecycle status projection.

## Class 2 — Controlled Representation

Purpose:

- represent an approved SRA instrument, unit, entitlement, or Participation Position on an external chain;
- allow eligible movement subject to SRA authorization and reconciliation;
- preserve SRA as the authoritative register.

The chain object is a controlled representation of the SRA record.

A wallet transfer is not final in SRA until the event is observed, validated, matched to eligible participants, and reconciled into the SRA ownership and lifecycle records.

This is the default target model for the platform funding instrument.

## Class 3 — Native Instrument Projection

Purpose:

- allow the blockchain object itself to become the authoritative or legally operative form of an instrument.

This class is not activated by the Phase 1 architecture.

It requires a separately approved legal, compliance, custody, transfer, disclosure, recordkeeping, redemption, and market-structure architecture.

No SRA instrument becomes native on-chain merely because a token is minted.

---

# Phase 1 Scope

Phase 1 establishes the Controlled Representation model for approved SRA instruments and Participation Positions, beginning with the SRA platform funding instrument.

Phase 1 includes:

- canonical projection records;
- projection eligibility;
- Solana network configuration;
- authorized mint creation;
- token-to-SRA linkage;
- approved wallet registry;
- supply controls;
- transfer policy hooks;
- freeze and retirement controls;
- chain event observation;
- reconciliation;
- audit and lifecycle events;
- public and private projection boundaries.

Phase 1 does not include:

- automatic public sale;
- permissionless transfer;
- automatic classification of the instrument;
- automatic legal enforceability;
- automatic exchange listing;
- automatic custody;
- automatic participant eligibility;
- replacement of the SRA authoritative register;
- issuance before SRA activation;
- creation of value solely through token minting.

---

# Authoritative Record Rule

For Phase 1:

- the SRA instrument record is authoritative;
- the SRA Participant Engine is authoritative for participant identity and eligibility;
- the SRA ownership register is authoritative for recognized ownership;
- the SRA lifecycle ledger is authoritative for instrument status;
- the SRA Optional Settlement Layer is authoritative for settlement availability and participant-directed settlement instructions;
- Solana is an approved external representation and event rail;
- every chain event must return to SRA through reconciliation.

The chain representation must never exceed or contradict the authoritative SRA record.

---

# Canonical On-Chain Projection Record

Every projection must have an SRA On-Chain Projection Record.

Required fields:

- projection_id;
- projection_class;
- network;
- cluster;
- chain_program;
- mint_or_contract_address;
- authoritative_sra_record_type;
- authoritative_sra_record_id;
- instrument_id;
- issuer_participant_id;
- verified_value_package_id;
- permanent_asset_account_id, when applicable;
- participation_position_id, when applicable;
- authorized_supply;
- issued_supply;
- circulating_supply;
- retired_supply;
- unit_definition;
- denomination;
- currency_or_value_reference;
- issue_date;
- maturity_date, when applicable;
- transferability_status;
- settlement_status;
- projection_status;
- metadata_uri_or_digest;
- governing_record_digest;
- eligibility_policy_id;
- transfer_policy_id;
- custody_policy_id, when applicable;
- reconciliation_policy_id;
- created_by;
- approved_by;
- approval_event_id;
- created_at;
- activated_at;
- suspended_at;
- retired_at;
- last_reconciled_at.

Projection statuses:

- Draft;
- Under Review;
- Approved;
- Mint Pending;
- Active;
- Suspended;
- Matured;
- Settlement Available;
- Settled;
- Retired;
- Closed;
- Rejected;
- Reconciliation Exception.

---

# Platform Funding Instrument Projection

The SRA platform funding instrument remains the existing SRA funding instrument.

The On-Chain Projection Layer does not rename it, recreate it, or replace its existing economic and legal terms.

Before projection, SRA must have:

- an authoritative instrument ID;
- issuer identity;
- instrument purpose;
- authorized amount;
- unit or denomination structure;
- issue date;
- maturity date or duration rule;
- payment, return, or completion terms;
- holder rights;
- transferability rule;
- eligible participant rule;
- governing records;
- Verified Value Package linkage;
- issuance authorization;
- active lifecycle status;
- ownership-register rule;
- settlement and retirement rule.

The Phase 1 Solana object represents approved units or positions associated with the platform funding instrument.

It does not create additional principal, authorized value, or obligation beyond the authoritative SRA instrument.

---

# Projection Eligibility

An SRA record may enter projection review only when:

1. the underlying economic and financial relationship is documented;
2. the transaction evidence is complete under the applicable internal standard;
3. provenance is preserved;
4. verification is complete;
5. a Verified Transaction Record or equivalent recognized source record exists;
6. a frozen or approved Verified Value Package exists where required;
7. the instrument or position is issued or otherwise active;
8. the authoritative terms are complete;
9. the holder or participant rights are defined;
10. transferability is explicitly defined;
11. participant eligibility is defined;
12. the authorized supply or unit quantity is defined;
13. the projection class is approved;
14. the blockchain rail is approved;
15. wallet and custody rules are defined;
16. reconciliation rules are active;
17. no unresolved exception blocks projection.

Projection eligibility is distinct from marketplace eligibility and settlement eligibility.

---

# Solana Projection Components

## Network Registry

Stores approved Solana environments and network settings.

Initial environments:

- local or test environment;
- Solana devnet;
- Solana mainnet-beta only after separate activation approval.

## Mint Authority

The mint authority creates only the approved supply associated with an approved projection record.

Minting must be blocked when:

- the projection is not approved;
- the instrument is inactive, suspended, closed, or rejected;
- the requested quantity exceeds authorized supply;
- the governing record digest does not match;
- the required approval event is absent;
- an unresolved reconciliation exception exists.

## Freeze Authority

The freeze authority may suspend movement when required by:

- instrument suspension;
- participant ineligibility;
- reconciliation exception;
- maturity;
- settlement processing;
- duplicate or unauthorized supply detection;
- court, regulatory, contractual, or operating restriction recorded by SRA;
- security incident.

Freeze does not erase ownership history.

## Metadata Authority

Approved metadata may expose:

- SRA instrument identifier;
- projection identifier;
- projection class;
- approved public description;
- issue and maturity dates;
- current lifecycle status;
- public registry reference;
- governing record digest;
- supply information permitted for projection.

Private participant, evidence, transaction, settlement, and destination information must not be placed in public metadata.

## Transfer Policy

The transfer policy may require:

- sender wallet eligibility;
- recipient wallet eligibility;
- participant identity linkage;
- transfer-window validation;
- instrument status validation;
- maturity validation;
- jurisdiction or participant-class validation;
- quantity validation;
- SRA authorization or pre-clearance;
- post-transfer reconciliation.

The exact Solana mechanism may use approved token extensions, program controls, or another reviewed technical structure.

The architecture does not depend on a specific extension until implementation review selects it.

## Chain Event Observer

Observes:

- mint events;
- transfers;
- freezes;
- thaws;
- burns or retirements;
- authority changes;
- metadata changes;
- failed transactions;
- duplicate or conflicting events.

Observed events are not automatically accepted as authoritative SRA events.

They must pass matching and reconciliation.

---

# Wallet Registry

The Participant Engine maintains the relationship between an SRA participant and an approved external wallet.

Wallet records include:

- wallet_id;
- participant_id;
- network;
- wallet_address;
- wallet_role;
- custody_type;
- verification_method;
- eligibility_status;
- permitted_projection_classes;
- permitted_instrument_types;
- jurisdictional context;
- approval status;
- effective date;
- suspension date;
- revocation date;
- evidence references;
- lifecycle events.

A wallet address alone is not treated as a complete SRA participant identity.

---

# Supply Integrity

For every active controlled representation:

    Authorized SRA Units
            =
    Unissued Units
        + Circulating On-Chain Units
        + Held or Restricted Units
        + Retired Units

SRA must reject or suspend a state where:

- on-chain issued supply exceeds SRA authorized supply;
- circulating units cannot be matched to recognized positions or holders;
- retired units remain transferable;
- an instrument is closed while active supply remains unresolved;
- multiple chain representations claim the same authoritative units without an approved multi-rail rule.

---

# Projection Lifecycle

    Draft Projection Request
            ↓
    Authoritative Record Resolution
            ↓
    Projection Eligibility Review
            ↓
    Projection Class Selection
            ↓
    Network and Program Selection
            ↓
    Terms and Supply Freeze
            ↓
    Participant and Wallet Controls
            ↓
    Projection Approval
            ↓
    Mint or Chain Record Creation
            ↓
    Initial Allocation
            ↓
    Active Observation
            ↓
    Transfer, Hold, Freeze, Settlement, or Redeployment Events
            ↓
    Reconciliation
            ↓
    Updated SRA Instrument, Position, Ownership, and Lifecycle Records
            ↓
    Maturity, Retirement, Closure, or Continued Circulation

---

# Transfer Lifecycle

    Transfer Request
            ↓
    Instrument Status Check
            ↓
    Sender Participant and Wallet Check
            ↓
    Recipient Participant and Wallet Check
            ↓
    Quantity and Rights Check
            ↓
    Transfer Authorization
            ↓
    Solana Transfer Execution
            ↓
    Chain Confirmation
            ↓
    SRA Event Matching
            ↓
    Ownership and Position Reconciliation
            ↓
    Updated Authoritative Register

A chain confirmation without successful SRA reconciliation creates a Reconciliation Exception and may trigger a freeze or investigation workflow.

---

# Maturity and Settlement Lifecycle

    Instrument or Position Reaches Maturity or Completion
            ↓
    SRA Lifecycle Event
            ↓
    New Transfers Restricted as Required
            ↓
    Settlement Available
            ↓
    Participant Settlement Choice
            ↓
    Settlement Instruction
            ↓
    Execution
            ↓
    Chain Unit Retirement or Reclassification
            ↓
    Confirmation
            ↓
    Reconciliation
            ↓
    Updated Instrument, Position, and Asset History
            ↓
    Closure Eligibility

The Solana representation does not force settlement.

The Optional Settlement Layer remains participant-directed.

---

# Reconciliation

Reconciliation connects every approved external chain event back to SRA.

Reconciliation checks:

- network and program identity;
- transaction signature;
- mint or contract identity;
- projection identity;
- authoritative SRA record identity;
- sender and recipient wallet linkage;
- participant eligibility;
- instrument lifecycle status;
- quantity;
- supply integrity;
- event order;
- duplicate detection;
- settlement state;
- retirement state;
- resulting ownership and position balances.

Reconciliation outcomes:

- Matched;
- Matched with Warning;
- Pending Confirmation;
- Rejected;
- Duplicate;
- Unauthorized;
- Supply Variance;
- Ownership Variance;
- Lifecycle Conflict;
- Reconciliation Exception.

Every reconciliation outcome becomes a durable lifecycle and audit event.

---

# Privacy and Public Projection

The Public Registry may expose approved projection information without exposing private source evidence or participant instructions.

Permitted public fields may include:

- projection ID;
- instrument ID;
- public instrument name;
- projection class;
- network;
- mint or contract address;
- approved supply figures;
- issue date;
- maturity date;
- lifecycle status;
- public governing digest;
- public settlement or retirement status.

Private fields include:

- unapproved participant identity;
- private wallet linkage;
- source documents;
- full transaction evidence;
- settlement destination;
- private pricing or allocation instructions;
- internal eligibility analysis;
- private exceptions and investigation records.

Public blockchain visibility does not authorize publication of private SRA records.

---

# Sane Responsibilities

Sane may:

- explain projection classes;
- display whether an instrument is projection-eligible;
- identify missing authoritative fields;
- prepare a projection request;
- display proposed supply and unit structure;
- show participant and wallet eligibility;
- request explicit approvals;
- prepare mint instructions;
- display chain confirmations;
- surface reconciliation warnings and exceptions;
- guide maturity, settlement, retirement, and closure workflows.

Sane may not:

- mint without approval;
- increase authorized supply;
- redefine the instrument;
- classify an instrument automatically as legally compliant;
- represent a chain confirmation as final ownership before reconciliation;
- publish private evidence;
- select a participant wallet without authorization;
- force settlement;
- conceal a supply or ownership variance;
- convert a controlled representation into a native instrument without separately approved architecture.

---

# Security Boundaries

Phase 1 must separate:

- SRA application authority;
- mint authority;
- freeze authority;
- metadata authority;
- treasury or allocation wallet;
- participant wallets;
- observation services;
- reconciliation services;
- approval services;
- public registry projection.

No single uncontrolled user action should be able to:

- create a projection;
- mint supply;
- assign ownership;
- alter metadata;
- bypass participant eligibility;
- close reconciliation;
- retire an instrument.

Authority changes must be recorded as SRA lifecycle events.

---

# Failure and Exception Rules

The layer must stop or suspend projection activity when:

- the authoritative record is missing or inconsistent;
- the governing digest changes without approved amendment;
- issued supply exceeds authorization;
- the chain mint does not match the projection record;
- a transfer involves an unapproved wallet;
- a chain event cannot be reconciled;
- the instrument is suspended, matured, settled, retired, or closed against policy;
- required approvals are missing;
- the external network is degraded or unsafe for the selected operation;
- a security event affects authority keys or program controls.

The authoritative SRA record must preserve the unresolved state until reconciliation or formal resolution is complete.

---

# Phase 1 Implementation Components

1. On-Chain Projection domain model.
2. Projection eligibility service.
3. Network registry.
4. Participant wallet registry.
5. Solana adapter interface.
6. Mint and metadata service.
7. Supply-control service.
8. Transfer-policy service.
9. Chain event observer.
10. Reconciliation service.
11. Projection lifecycle router and API.
12. Public Registry projection policy.
13. Sane guided projection workflow.
14. Audit and lifecycle event vocabulary.
15. Test environment and devnet validation suite.

---

# Phase 1 Acceptance Conditions

Phase 1 is complete when SRA can:

- select an existing active SRA platform funding instrument;
- verify that its authoritative terms and Verified Value linkage are complete;
- approve a Controlled Representation projection;
- create a Solana devnet mint or equivalent controlled record;
- issue no more than the authorized SRA supply;
- allocate units only to approved participant wallets;
- observe transfers and authority events;
- reconcile chain events into SRA ownership and lifecycle records;
- freeze or suspend unresolved exceptions;
- retire units through an approved maturity or settlement workflow;
- preserve SRA as the authoritative register;
- display the full projection history through Sane and the applicable registry views.

---

# Guiding Principles

1. SRA forms the instrument before any blockchain projection.
2. Verified Value precedes projection.
3. Projection does not create underlying value.
4. The Phase 1 model is a Controlled Representation.
5. SRA remains the authoritative register.
6. Solana is an external representation and event rail.
7. Supply may never exceed the authoritative SRA authorization.
8. Wallets are linked to participants; wallets do not replace participant identity.
9. Every chain event returns through reconciliation.
10. Chain confirmation is not final SRA recognition without successful reconciliation.
11. Public blockchain visibility does not authorize publication of private SRA information.
12. The projection layer does not rename, redesign, or replace the platform funding instrument.
13. Settlement remains participant-directed.
14. Native on-chain instruments require separately approved architecture.
15. The network adapter may change without changing the authoritative SRA instrument.

---

# Current Decision

The initial SRA on-chain target is a Controlled Representation of the existing SRA platform funding instrument on Solana.

SRA retains the authoritative instrument, participant, ownership, Verified Value, settlement, and lifecycle records.

The next implementation work is the domain model, projection eligibility service, participant wallet registry, Solana adapter, chain observer, and reconciliation service.