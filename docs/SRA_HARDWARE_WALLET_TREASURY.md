# SRA Hardware Wallet Treasury

## Purpose

This layer registers and monitors the public Base address controlled by SRA's offline hardware wallet.

## Security boundary

SRA stores only public wallet metadata:

- wallet label
- Base public address
- network and chain ID
- supported asset
- optional device and derivation references
- wallet state
- observed blockchain activity

SRA never stores:

- private keys
- seed phrases
- recovery phrases
- signing PINs
- device unlock credentials

All signing remains outside the web platform on the hardware wallet.

## Current network

- Network: Base mainnet
- Chain ID: 8453
- Asset: USDC
- Wallet type: Hardware

## Treasury flow

1. Platform Administration registers the hardware wallet public address.
2. SRA stores the address as a Treasury Crypto Wallet record.
3. Verified incoming and outgoing activity is linked to the wallet.
4. Confirmed activity contributes to the recorded USDC treasury position.
5. Pending activity remains visible but does not change the recorded balance.
6. Any outgoing transaction must be signed outside SRA on the hardware wallet.

## API

- `GET /api/platform-treasury/crypto-wallets`
- `POST /api/platform-treasury/crypto-wallets`
- `GET /api/platform-treasury/crypto-wallets/dashboard`
- `GET /api/platform-treasury/crypto-wallets/:walletId`
- `GET /api/platform-treasury/crypto-wallets/:walletId/position`
- `POST /api/platform-treasury/crypto-wallets/:walletId/state`
- `GET /api/platform-treasury/crypto-activity`
- `POST /api/platform-treasury/crypto-activity`

## Account separation

The hardware wallet is a treasury control point. Participant ownership remains recorded in each Universal Account and Asset Vault. A treasury wallet balance is not treated as platform revenue and does not replace participant-specific ledger liabilities.
