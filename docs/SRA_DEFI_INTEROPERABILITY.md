# SRA DeFi Interoperability

**Status:** Architecture Extension

## Purpose

SRA remains a Verified Value real-asset marketplace. DeFi interoperability allows approved SRA identities, proofs, pool positions, purpose-bound instruments, and settlement instructions to interact with decentralized rails without converting the private SRA core into a public blockchain application.

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
├── Participation Positions
├── Settlement Instructions
├── True Bills
└── Sane Orchestration
        ↓
Cryptographic Proof Layer
├── Signed event hashes
├── Merkle roots
├── Verifiable Credentials
├── VVP attestations
├── Position-state commitments
└── Settlement confirmation commitments
        ↓
DeFi Interoperability Layer
├── Wallet-linked authorization
├── Public proof verification
├── Productive pool positions
├── Optional instrument representation
├── Optional SRA settlement coin
└── Programmatic and cross-platform settlement
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
- Participation-position commitments
- Settlement-instruction hashes
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

## 8. Optional SRA Settlement Coin

The SRA settlement coin is an optional digital settlement medium for recognized SRA transactions and eligible cross-platform transactions.

It does not replace:

- the underlying real-world asset;
- the Verified Value Package;
- the participation position;
- the True Bill;
- or the authoritative SRA lifecycle record.

The settlement coin may be selected only after:

1. a verified marketplace outcome is completed;
2. settlement is recorded as available;
3. the participant selects settlement;
4. a Settlement Instruction is created and authorized;
5. the selected route is eligible.

```text
OUTCOME_COMPLETED
  -> SETTLEMENT_AVAILABLE
  -> PARTICIPANT AUTHORIZATION
  -> SETTLEMENT INSTRUCTION
  -> COIN OR OTHER RAIL SELECTED
  -> EXECUTION
  -> CONFIRMATION
  -> RECONCILIATION
```

No participant is required to use the settlement coin. The participant may instead hold, transfer, redeploy, or use another approved settlement route.

## 9. Cross-Platform Settlement

SRA may route an eligible settlement position to another approved platform while preserving SRA as the authoritative source for the original position.

Cross-platform settlement records must identify:

- source and destination platforms;
- source position and exact version;
- participant authority;
- selected settlement medium;
- amount or position state;
- conversion or translation terms where applicable;
- outbound instruction;
- destination confirmation;
- reconciliation state.

A destination platform confirmation is required before SRA records the route as completed.

## 10. Execution Classes

```text
PRIVATE ENGINE LOGIC
Personal data, valuations, evidence, agreements, internal positions, settlement instructions

SHARED CONSORTIUM LOGIC
Institutional approvals, custody states, settlement coordination, cross-platform confirmations

PUBLIC BLOCKCHAIN LOGIC
Proof anchors, approved transferable positions, optional settlement coin transfers, final state commitments
```

## 11. Interoperability Guardrails

SRA does not require:

- A speculative SRA coin
- Mandatory wallets
- Mandatory settlement through the SRA coin
- Public storage of private asset records
- Anonymous asset issuance
- Automatic price-only liquidation
- Token ownership as platform governance
- Universal tokenization of lifecycle events

SRA requires:

- an authoritative source position;
- participant authorization;
- a durable Settlement Instruction;
- route eligibility;
- execution evidence;
- destination confirmation for cross-platform movement;
- and reconciliation back to the SRA record.

## 12. Implementation Sequence

### Phase 1 — Domain Readiness

- Wallet connection records
- Signature challenge model
- Deterministic event hashing
- Credential schemas
- Pool utilization model
- Completion Health model
- Participation-position lifecycle
- Settlement Instruction model

### Phase 2 — Proof Services

- Public proof verification endpoint
- Credential verification endpoint
- VVP hash registry
- True Bill state verification
- Position and settlement-instruction verification

### Phase 3 — External Representations

- Sandbox wallet authorization
- Test-network proof anchoring
- Optional instrument representations
- Productive pool position representations
- Settlement-coin sandbox representation

### Phase 4 — Settlement Interoperability

- Approved custody adapters
- Institutional settlement adapters
- Approved blockchain settlement paths
- SRA settlement coin path
- Cross-platform settlement messages and confirmations
- Cross-rail reconciliation

## Governing Principle

> SRA is not converted into DeFi. SRA selectively uses decentralized authorization, proof, pool, and settlement mechanisms to extend Verified Value across financial rails.

The authoritative optional-settlement architecture is defined in:

`docs/SRA_V18_OPTIONAL_SETTLEMENT_AND_CROSS_PLATFORM.md`
