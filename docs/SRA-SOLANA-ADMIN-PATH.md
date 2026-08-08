# SRA Solana administrative path

SRA remains authoritative for its coin supply.

`Coin Positions → Put SRA On Chain → SRA mint → platform token account → destination Solana address → transaction signature`

The on-chain mint is created once. Its initial issued amount is capped to the active SRA Coin Position aggregate at creation. Sending SRA uses the same platform signer and ordinary Solana address flow as sending SOL. DEX execution is optional and downstream of this path.
