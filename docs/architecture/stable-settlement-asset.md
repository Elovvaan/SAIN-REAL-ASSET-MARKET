# Stable Settlement Asset

SRA supports a stable settlement asset as a settlement-value layer beneath the existing financing and instrument lifecycle.

The stable settlement asset does not replace a financing instrument, closing record, authorized disbursement, export package, or settlement route selection. It is the asset selected when an authorized transaction settles through `ON_CHAIN_SETTLEMENT`.

## Canonical flow

`financing transaction → instrument → closing → authorized disbursement → export package → settlement route → settlement asset → on-chain transfer → transaction ID → confirmation → record`

For a stable settlement transfer, the final segment is:

`ON_CHAIN_SETTLEMENT → SRA_USD → selected network → destination address → existing OnChainTransferService`

The generic on-chain interface remains:

- `asset`
- `amount`
- `destinationAddress`
- `network`

No network is defaulted by the stable settlement asset layer.

## Stable settlement asset lifecycle

The monetary lifecycle is separate from the financing lifecycle and from the generic blockchain transfer mechanism:

`definition → reserve record → network representation → issuance → circulation → redemption → reserve reconciliation`

The initial canonical code is `SRA_USD`, denominated in USD with a unit value of 1 and a `FULL_RESERVE` reserve policy.

That initial full-reserve definition remains an available settlement product;
it is not the Direct Value Account's native authorized-transaction asset. The
native account asset is `SRA-USD`, and its issuance authority is a posted SRA
funding authorization rather than a recycled treasury or participant balance.
When native `SRA-USD` moves to a public rail, the Direct Value Account service
reduces or locks the native position and records the registered rail
representation so the same units cannot be counted twice. See
`direct-multi-asset-account-and-native-funding.md`.

### Definition

A definition establishes the stable settlement asset identity, denomination, unit value, reserve policy, settlement purpose, and lifecycle state.

### Reserve records

Reserve entries are explicit credits and debits. Under `FULL_RESERVE`, issuance cannot make circulating supply exceed recorded reserves, and reserve debits cannot reduce reserve coverage below circulating supply.

### Network representations

A stable settlement asset can have representations on multiple supported networks. Each representation records its network, network asset code, optional on-chain asset record, asset address, issuer address, decimals, and state.

Representation creation remains distinct from transfer execution. The existing on-chain asset creation/issuance services remain responsible for network-specific mechanics.

### Issuance and redemption

Stable settlement supply events record issuance and redemption. They may retain network, destination/source address, transaction ID, and settlement reference so monetary supply records can be reconciled to network execution and financing settlement records.

## API surface

The existing `/api/on-chain` router exposes:

- `GET /stable-settlement-assets`
- `GET /stable-settlement-assets/:assetCode`
- `POST /stable-settlement-assets`
- `POST /stable-settlement-assets/:assetCode/reserves`
- `POST /stable-settlement-assets/:assetCode/representations`
- `POST /stable-settlement-assets/:assetCode/issue`
- `POST /stable-settlement-assets/:assetCode/redeem`

Writes require the same authenticated SRA actor identity used by existing on-chain writes.

## Separation from payment rails

ACH, Fedwire, bank wire, and internal transfer remain in the settlement-rail gateway. The stable settlement asset is not added as an ACH/Fedwire rail. It is selected as an asset under the existing `ON_CHAIN_SETTLEMENT` route and transferred through the generic on-chain transfer service.
