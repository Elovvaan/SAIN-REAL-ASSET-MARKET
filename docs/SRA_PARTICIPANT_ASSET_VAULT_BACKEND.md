# SRA Participant Asset Vault Backend

## Purpose

This phase connects the participant-facing Asset Vault to authenticated SRA account identity and participant-linked transaction records.

The Asset Vault is an account read model. It does not create money, assign an opening balance, or transfer ownership of participant assets to SRA.

## Identity Keys

A signed-in participant is resolved by:

- `userId`
- `universalAccountId`

A transaction belongs in the participant vault when its normalized participant or account references match either authenticated identity key.

## Balance Rule

The vault balance is calculated only from completed participant-linked transactions.

- incoming transactions increase the recorded balance;
- outgoing transactions decrease the recorded balance;
- a participant-only transaction with no directional account reference is recorded as activity but does not create a balance by assumption;
- market-wide volume is never treated as an individual balance.

## Endpoint

`GET /api/access/vault`

Returns:

- authenticated participant identity;
- ownership and custody language;
- recorded balance;
- incoming and outgoing totals;
- completed, pending, and verified counts;
- participant-linked transaction history.

## Boundary

This is a read model over existing SRA records. Posting, funding, settlement authorization, and external custody remain separate governed workflows.
