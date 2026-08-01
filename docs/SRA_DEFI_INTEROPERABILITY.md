# SRA DeFi Interoperability

**Status:** Architecture Extension

## Purpose

SRA remains a Verified Value real-asset marketplace. DeFi interoperability allows approved SRA identities, proofs, pool positions, and purpose-bound instruments to interact with decentralized rails without converting the private SRA core into a public blockchain application.

## Core Rule

> The SRA domain object remains authoritative. Blockchain records are proofs, representations, authorizations, or settlement positions derived from that object.

## Architecture

```text
SRA Controlled Core
├── Participant Accounts
├── Asset Accounts
├── Lifecycle Records
├── Verified Value Packages
├── Projects
├── True Bills
└── Sane Orchestration
        ↓
Cryptographic Proof Layer
├── Signed event hashes
├── Merkle roots
├── Verifiable Credentials
├── VVP attestations
└── Instrument state commitments
        ↓
DeFi Interoperability Layer
├── Wallet-linked authorization
├── Public proof verification
├── Productive pool positions
├── Optional instrument representation
└── Programmatic settlement
```

## 1. Wallet-Linked Participant Identity

A wallet is not the participant. It is an authorized signing or holding context connected to a unified SRA Participant Account.

```text
Participant Account
├── SRA identity
├── Institutional identity
├── Organization authority
├── Custody wallet
└── Self-custody wallet
```

Wallet permissions remain role- and scope-bound.

## 2. Proof Anchoring

Private operational records stay inside SRA. The platform may publish deterministic proofs of selected events or frozen packages.

Anchors may include:

- Lifecycle event hashes
- Merkle roots
- Verified Value Package hashes
- Credential status references
- True Bill state commitments
- Settlement confirmation hashes

## 3. Verifiable Credentials

SRA uses credentials to prove facts without making those facts transferable assets.

Examples:

- Contractor qualification
- Inspection completion
- Production verification
- Milestone approval
- Participant authority
- Verified Value Package attestation

Credential roles:

```text
Issuer → Holder → Verifier
```

## 4. Productive Pool Positions

Marketplace Pools may expose digital positions representing contributed productive capacity.

Pool categories:

- Capital capacity
- Material reserves
- Equipment availability
- Service capacity
- Completion capacity
- Regional development commitments

Each position records source, quantity, deployment, utilization, restrictions, and settlement state.

## 5. Productive Utilization

```text
Deployed Productive Capacity
────────────────────────────
Total Available Capacity
```

Utilization may be displayed for capital, materials, equipment, services, and completion capacity.

## 6. Completion Health

SRA uses productive Completion Health rather than a price-only liquidation factor.

Inputs include:

- Verified Value coverage
- Funding coverage
- Milestone completion
- Participant availability
- Asset condition
- Schedule stability
- Remaining completion gap

States:

- HEALTHY
- WATCH
- SUPPORT_REQUIRED
- COMPLETION_ELIGIBLE
- CRITICAL
- CLOSED

## 7. Optional True Bill Representation

The authoritative True Bill remains inside SRA. An approved external representation may be created for interoperability.

Representation modes:

- Signed credential
- Unique digital instrument position
- Divided participation position
- Institutional ledger position
- Purpose-bound settlement position

The representation never replaces the SRA instrument record.

## 8. Execution Classes

```text
PRIVATE ENGINE LOGIC
Personal data, valuations, evidence, agreements, internal positions

SHARED CONSORTIUM LOGIC
Institutional approvals, custody states, settlement coordination

PUBLIC BLOCKCHAIN LOGIC
Proof anchors, approved transferable positions, final state commitments
```

## 9. Interoperability Guardrails

SRA does not require:

- A speculative SRA coin
- Mandatory wallets
- Public storage of private asset records
- Anonymous asset issuance
- Automatic price-only liquidation
- Token ownership as platform governance
- Universal tokenization of lifecycle events

## 10. Implementation Sequence

### Phase 1 — Domain Readiness

- Wallet connection records
- Signature challenge model
- Deterministic event hashing
- Credential schemas
- Pool utilization model
- Completion Health model

### Phase 2 — Proof Services

- Public proof verification endpoint
- Credential verification endpoint
- VVP hash registry
- True Bill state verification

### Phase 3 — External Representations

- Sandbox wallet authorization
- Test-network proof anchoring
- Optional instrument representations
- Productive pool position representations

### Phase 4 — Settlement Interoperability

- Approved custody adapters
- Institutional settlement adapters
- Approved blockchain settlement paths
- Cross-rail reconciliation

## Governing Principle

> SRA is not converted into DeFi. SRA selectively uses decentralized authorization, proof, pool, and settlement mechanisms to extend Verified Value across financial rails.
