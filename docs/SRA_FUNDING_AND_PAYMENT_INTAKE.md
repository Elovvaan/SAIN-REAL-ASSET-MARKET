# SRA Funding and Payment Intake

## Purpose

SRA uses two separate outside-money paths.

1. **Asset Vault funding** records participant funds intended for future market participation.
2. **Platform fee payment** records money paid to satisfy a platform invoice.

These paths do not share the same economic destination.

## Asset Vault funding

```text
Participant outside account
  -> funding instruction
  -> external ACH, wire, or transfer
  -> segregated participant-funds cash
  -> participant-funds liability
  -> verified funding event
  -> participant Asset Vault balance
```

Creating a funding instruction does not credit the participant. The balance changes only after an authorized operator records the external transfer reference.

The accounting entry is:

```text
Debit  Participant Funds Cash
Credit Participant Funds Payable
```

The credit is a liability because the funds remain attributable to the participant and are not platform revenue.

## Platform fee payment

```text
Participant outside account
  -> fee payment instruction linked to an invoice
  -> external payment rail
  -> SRA operating cash
  -> accounts receivable cleared
  -> invoice and charges marked paid
```

The accounting entry is:

```text
Debit  Operating Cash
Credit Accounts Receivable
```

A direct outside fee payment is visible as participant-linked economic activity but does not reduce the participant's Asset Vault balance because the payment did not originate from the vault.

## Confirmation authority

External funds are confirmed only from the Platform Administration operating capacity and require an outside transfer reference. Confirmation produces:

- a funding instruction in `CONFIRMED` state,
- a balanced ledger entry,
- a payment receipt,
- and a Verified Market Event.

## Current rails

The present implementation creates and records funding instructions for ACH, wire, card where applicable, and external transfer. It does not claim that a live processor or bank connector has moved funds. A real provider adapter must later deliver the external confirmation reference.
