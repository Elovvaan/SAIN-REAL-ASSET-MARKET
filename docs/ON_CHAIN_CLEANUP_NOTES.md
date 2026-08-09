# On-chain cleanup notes

Current execution boundary:

- Direct SOL transfer: `/api/on-chain/solana/transfers`
- SRA mint/supply synchronization: `/api/on-chain/solana/sra/mint`
- SRA token transfer: `/api/on-chain/solana/sra/transfers`
- Projection records remain metadata/reconciliation records only.
- Legacy projection mint/allocation API routes were removed in PR #249 because they could generate simulated chain identifiers.

Connection surface scan:

- Solana has a real direct-chain execution implementation.
- Coinbase has implemented market/transaction services and is not merely a placeholder.
- Ethereum and Bitcoin currently appear as administration connection tabs but no corresponding direct-chain execution implementation was found in the repository scan.

Cleanup rule:

Do not expose a chain as an executable connection until the repository contains a real implementation using the public protocol/SDK/node path for that network. Do not create simulated transaction identifiers for live platform flows.
