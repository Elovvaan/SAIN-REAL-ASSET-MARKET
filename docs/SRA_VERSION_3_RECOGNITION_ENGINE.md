# SRA Version 3 — Recognition Engine

Version 3 is the locked architecture for SAIN Real Asset Market.

## Operating cycle

Outside World
→ Observation Layer
→ SAIN Recognition Engine
→ Financial Record Layer
→ Coin Representation Layer
→ Instrument Engine
→ Transaction Engine
→ Transaction Market
→ Marketplace
→ Continuous Recognition

## Locked phases

1. Observation Layer
2. SAIN Recognition Engine
3. Financial Record Layer
4. Coin Representation Layer
5. Instrument Engine
6. Transaction Engine
7. Transaction Market
8. Marketplace
9. Continuous Recognition

## Phase 1 — Observation Layer

The Observation Layer observes and preserves external market records before recognition, valuation, coin allocation, instrument preparation, or transaction treatment.

It records:

- source market
- source record identifier
- source record type
- source timestamp
- SRA observation timestamp
- category
- raw values
- raw payload
- payload digest
- connector identifier
- observation state

Phase 1 does not normalize, interpret, recognize, value, allocate coin, create instruments, or post ledger entries.

The source payload is preserved exactly as received. Any later transformation must create a separate downstream record that points back to the observation.
