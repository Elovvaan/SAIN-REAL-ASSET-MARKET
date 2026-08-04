# SRA Crypto Funding V1

## Scope

V1 verifies USDC transfers on Base before SRA recognizes outside crypto funding.

The verifier checks:

- Base chain ID `8453`
- the official Base USDC contract
- successful transaction receipt status
- ERC-20 `Transfer` event recipient
- exact expected USDC amount using six decimals
- minimum confirmation count
- transaction hash, sender, recipient, block, and confirmation evidence

## Required Railway variables

```text
SRA_CRYPTO_RECEIVING_ADDRESS=0x...
BASE_RPC_URL=https://mainnet.base.org
BASE_CHAIN_ID=8453
BASE_USDC_CONTRACT=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
BASE_MINIMUM_CONFIRMATIONS=2
```

`SRA_CRYPTO_RECEIVING_ADDRESS` must be an address controlled by the properly designated external crypto-holding arrangement. No private key or seed phrase belongs in the repository.

## Funding sequence

```text
Participant creates crypto funding instruction
        ↓
Instruction fixes account, amount, USDC, Base, and receiving address
        ↓
Participant sends USDC
        ↓
SRA receives the transaction hash
        ↓
Server verifies the on-chain Transfer event and confirmations
        ↓
Blockchain receipt is recorded
        ↓
Existing participant-funds ledger posting runs
        ↓
Verified Market Event credits the participant Asset Vault
```

## Recognition rule

A submitted transaction hash is not a balance. A pending, reverted, wrong-token, wrong-recipient, wrong-amount, wrong-network, or under-confirmed transaction must not credit the Asset Vault.

## Next connection step

The verifier will be connected to authenticated funding-instruction endpoints so each transaction hash can be used once and only against its original instruction. Confirmation will then reuse the existing participant-funds accounting path:

- Debit Participant Funds Cash
- Credit Participant Funds Payable

The USDC transfer is evidence of receipt; the SRA ledger remains the account source of truth.
