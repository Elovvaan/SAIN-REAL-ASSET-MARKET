# SRA Escrow / Custodial Settlement

## Purpose

Escrow / Custodial Settlement is a first-class SRA settlement route for transaction-specific conditional custody and release. It does not replace the financing lifecycle, approval authority, Phase 4 external-outcome verification, or the underlying transport rail. It gives SRA a governed intermediary route between an authorized financing disbursement and the final beneficiary.

## Settlement routes

SRA supports three architectural settlement families:

1. Direct settlement — the authorized transaction proceeds directly through the selected external settlement rail.
2. Escrow / custodial settlement — an independent escrow or custody counterparty receives the settlement asset, administers recorded release/return conditions, and produces external evidence.
3. On-chain settlement — an authorized digital-asset transaction proceeds through a supported network adapter.

Escrow can terminate into fiat banking rails or an appropriate digital-asset custody/transfer path. The escrow route therefore does not imply that banking or blockchain infrastructure disappears underneath it.

## Authoritative flow

House Morris / principal mandate
→ SRA financing or acquisition transaction
→ instrument and documentary evidence
→ administrator funding authorization
→ financing disbursement export package
→ escrow settlement instructions
→ escrow acknowledgement
→ settlement asset received by escrow
→ release conditions satisfied
→ escrow release
→ seller / beneficiary receipt
→ Phase 4 external outcome reconciliation
→ Phase 5 counterparty resolution if required
→ Phase 6 autonomous continuation when verified facts permit it
→ funded / servicing lifecycle.

## Escrow states

- INSTRUCTIONS_PREPARED
- ACKNOWLEDGED
- ASSET_IN_ESCROW
- EXCEPTION_REPORTED
- READY_FOR_RELEASE
- RELEASED
- RETURNED
- CANCELLED

ASSET_IN_ESCROW, READY_FOR_RELEASE, RELEASED, and RETURNED require an external evidence reference. A counterparty statement alone is not converted into verified settlement.

## Route types

### FIAT_ESCROW

Used when the settlement asset is fiat. The escrow/custodial counterparty may use its own permitted banking relationship and ACH, wire, Fedwire, check, or other supported external transport as applicable to the transaction.

### DIGITAL_ASSET_ESCROW

Used when the settlement asset is a recorded digital asset. The record identifies the settlement asset and, when applicable, its network. SRA remains network-neutral; the route does not default to any particular blockchain.

## Authority boundary

Creating escrow instructions is preparation, not settlement authorization. The route starts from an existing authoritative financing disbursement that is already AUTHORIZED or SUBMITTED. The escrow service does not approve financing, change terms, authorize payment, issue an instrument, transfer ownership, manufacture external evidence, or treat custody/release as verified merely because SRA recorded an internal state.

## Evidence and Phase 4

Escrow acknowledgement is operational evidence, not final settlement evidence. Custody receipt and release references are retained as external references. Phase 4 remains responsible for determining whether the external outcome is VERIFIED under the evidence rules already implemented by SRA.

## Business acquisition use

For an acquisition such as a going concern, the escrow file can bind the acquisition transaction, instrument, buyer/principal, seller/beneficiary, amount, closing documents, release conditions, return conditions, and external closing references. This allows the seller-facing workflow to focus on closing conditions and receipt while SRA preserves the complete financing and evidence chain.
