# Direct Multi-Asset Account and Native Funding

## Architectural decision

SRA operates three separate value domains:

1. **Participant Direct Value Accounts** hold participant-owned native and external asset positions.
2. **Authorized Origination** creates transaction capacity from an approved and posted SRA financing authorization. It does not consume participant balances or depend on recycled repayments.
3. **SRA Institutional Treasury** receives repayments for platform operations and growth. Repayments do not restore a lending pool or become the source of later originations.

No balance may be counted in more than one domain merely because SRA records, routes, or holds it.

## Native funding

A posted `LOAN_FINANCING_AUTHORIZATION` may create an equal native `SRA/USD` credit in the borrower's Direct Value Account. The funding authorization remains the obligation record; SRA/USD is the usable account value delivered under that authorization.

The credit is idempotent by financing transaction. It:

- creates no debit against an existing participant position;
- consumes no SRA treasury balance;
- does not imply an external transfer;
- cannot exceed the authorized financing amount; and
- produces an `AUTHORIZED_FUNDING_CREDIT` movement linked to the obligation.

## Multi-asset positions

Each position is identified by Direct Value Account, canonical asset, and location network. External assets retain their exact identity. A confirmed SOL deposit is recorded as SOL on Solana; it is not renamed or silently converted to SRA/USD.

External deposits require a confirmed network transaction and custody reference. Replayed transaction identifiers cannot create a second credit.

## Public-rail representations

SRA/USD has one canonical identity and may have registered rail representations. For example:

- Native: `SRA-USD`
- Stellar: asset code plus SRA issuer
- Ethereum: chain ID plus contract address
- Solana: network plus mint address

An outbound rail movement reduces the native position before or with confirmed public delivery. An inbound return removes or secures the public representation before the native position is restored. The recorded movement links the canonical asset, representation, network transaction, amount, and destination. This prevents native and public balances from representing the same units twice.

## External asset conversion

Conversion is distinct from rail movement.

- Rail movement changes the location of SRA/USD.
- Conversion exchanges SRA/USD or another held asset for a different asset.

SRA records a conversion only after an execution reference and executed quantities exist. The account service does not invent a quote or infer that an exchange occurred. A completed conversion atomically debits the source position, credits the target position, and records the executed rate and pricing source.

## Repayment and institutional growth

A repayment requires a confirmed settlement reference and creates an `INSTITUTIONAL_RECEIPT`. The receipt records:

- the related financing authorization;
- the amount and asset received;
- the remaining obligation before and after receipt;
- institutional use as platform operation and growth; and
- an explicit prohibition against treating the receipt as origination funding.

The architecture therefore does not model repayment as replenishment of available credit unless a separately defined product, such as an expressly revolving line, requires that different behavior.

## Obligation release

Default is a reassessment state, not automatic forgiveness. An authorized obligation release is a terminal resolution that follows repayment and collateral reconciliation. It requires explicit `APPROVE_RELEASE` authority and a decision rationale.

The release records original amount, repayments, remaining amount released, collateral-resolution reference, and an information-reporting determination state. It does not infer that a tax form is required or filed; it records `1099-C_WHEN_APPLICABLE` for the separate reporting determination.

## Canonical interfaces

Participant read interface:

- `GET /api/direct-accounts/me`

Platform Administration interfaces:

- `POST /api/direct-accounts/admin/funding-credits`
- `POST /api/direct-accounts/admin/external-deposits`
- `POST /api/direct-accounts/admin/rail-representations`
- `POST /api/direct-accounts/admin/rail-movements`
- `POST /api/direct-accounts/admin/conversions`
- `POST /api/direct-accounts/admin/repayments`
- `POST /api/direct-accounts/admin/obligation-releases`
- `GET /api/direct-accounts/admin/accounts/:directValueAccountId`

All write interfaces require authenticated Platform Administration authority. Participant pages expose recorded positions and movements without manufacturing execution state.
