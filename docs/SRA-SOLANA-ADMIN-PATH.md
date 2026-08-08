# SRA Solana administrative path

SRA remains authoritative for its coin supply.

`Coin Positions → SRA supply reconciliation → Put / Sync SRA On Chain → SRA mint → platform token account → destination Solana address → transaction signature`

The Solana mint is created once. It is not a fixed-cap snapshot of SRA. The platform's persistent Coin Position aggregate remains the source of truth, and later recognized SRA supply can be synchronized to the same mint administratively. Synchronization mints only the positive difference between current authoritative platform supply and confirmed on-chain issued supply; it does not recreate the mint or duplicate already-issued SRA.

Coin Positions reports the synchronized on-chain issued quantity as externalized supply. New platform issuance remains available until the administrator synchronizes it. If on-chain issued supply ever exceeds authoritative platform supply, synchronization stops and requires reconciliation rather than silently reducing or reminting supply.

Sending SRA uses the same platform signer and ordinary Solana destination-address flow as sending SOL. DEX execution is optional and downstream of this path.