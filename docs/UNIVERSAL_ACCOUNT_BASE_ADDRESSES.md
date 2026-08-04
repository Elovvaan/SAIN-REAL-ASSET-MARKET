# Universal Account Base Address Layer

Each authenticated SRA participant already has a private Universal Account and Asset Vault ledger. This layer attaches a dedicated Base USDC deposit-address record to that existing account.

## Account relationship

```text
Participant
  -> Universal Account
    -> Asset Vault
    -> Blockchain Account record
      -> dedicated Base deposit address
```

The blockchain address does not replace the Asset Vault, Coin Account, Financial Record Account, instrument, or transaction records. It is an external funding endpoint linked to the participant's internal account.

## Provisioning flow

1. The participant requests a blockchain account.
2. SRA records `AWAITING_PROVISIONING` for that Universal Account.
3. An authorized wallet system, hardware-wallet process, qualified provider, or Platform Administrator provisions a unique Base-compatible public address.
4. SRA records the public address and activates the blockchain account.
5. Crypto funding instructions use that participant-specific address.
6. The existing Base USDC verifier confirms the transaction before the Asset Vault is credited.

## Private-key boundary

SRA does not generate, receive, return, log, or store private keys or recovery phrases in this implementation. Only a public deposit address is recorded. The party provisioning the address remains responsible for the corresponding key-management arrangement.

## API

- `GET /api/blockchain-accounts/me`
- `POST /api/blockchain-accounts/me/request`
- `POST /api/blockchain-accounts/admin/:blockchainAccountId/provision`
- `POST /api/access/funding/crypto-instructions` now requires and uses the participant's active dedicated address.

## Recognition rule

Creating or provisioning an address does not create a balance. A verified Base USDC transfer linked to a Funding Instruction remains required before SRA posts Participant Funds Cash, Participant Funds Payable, the payment receipt, and the Verified Market Event.
