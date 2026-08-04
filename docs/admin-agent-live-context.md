# SAIN Administrative Live Context

The Platform Administration portal supplies a live summary with connector status and platform counts to the SAIN agent.

## Authority rule

A provider connector is evaluated from its own status record. For the Coinbase public market connector, that includes:

- enabled state
- connection state
- subscribed products
- received and recorded trade counts
- last message, trade, and heartbeat timestamps
- last error

Treasury wallet records, settlement-rail adapters, Coin Accounts, Coin Positions, and SRA Transactions are separate states. Zero records in those classes do not prove that a public market-data connector is absent or disconnected.

## Context flow

```text
Private Administration Summary
→ SRA Agent Request Context
→ Specific Connector Status
→ Separate Downstream Record Counts
→ Grounded Administrative Answer
```

The agent remains read-only for state changes. Live context improves diagnosis and explanation; it does not grant write access.
