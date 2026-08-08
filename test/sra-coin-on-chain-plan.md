# SRA on-chain administrative path

1. Existing active SRA Coin Positions remain the authoritative platform supply.
2. **Put SRA On Chain** creates the single Solana SRA mint and issues no more than that current platform supply to the SRA-controlled token account.
3. **Send SRA** moves SRA tokens from the platform token account to a participant or external Solana address.
4. Every successful send returns a Solana transaction signature and is recorded in SRA lifecycle history.
5. DEX actions remain optional downstream actions; they are not required for minting or sending SRA.
