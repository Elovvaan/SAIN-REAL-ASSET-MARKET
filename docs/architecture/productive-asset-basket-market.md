# Productive Asset Basket Market

The Productive Asset Basket Market lets approved native, external, and customer-created assets participate in a governed bundle without silently converting the contributed asset. It is distinct from SRA's informational reference markets and existing spot-order workflow.

## Lifecycle

1. **Formation** — a Market Professional, Institutional Operator, or Platform Administrator defines a fixed, benchmark, or governed basket.
2. **Admission** — an eligible provider submits a canonical asset. An Institutional Operator or Platform Administrator approves its evidence, recognition rate, network, and treatment.
3. **Participation** — a participant contributes an approved asset from a Direct Value Account. The original asset becomes restricted and basket participation units are issued at recorded recognized value.
4. **Close** — an authorized operator closes formation after the minimum recognized value is reached. Composition is fixed unless the basket uses the governed model.
5. **Performance** — operators record current verified value, actual gross value received, expenses, commitments, administration amounts, and supporting evidence.
6. **Distribution** — a Platform Administrator distributes no more than recorded undistributed value. SRA/USD is credited pro rata to the holders of active participation units.
7. **Reconstitution** — only governed baskets can record authorized additions or removals, each with rationale and evidence.

## Controls

- Assets must exist in the canonical asset registry before admission.
- Native, public-chain, and customer-created assets remain identified by canonical asset and network.
- Recognition is evidence-backed and does not represent an automatic exchange or price guarantee.
- Productive value must be recorded before it can be distributed.
- Distribution settlement references are idempotent.
- Fixed and benchmark compositions cannot be changed after close.

## API

The `/api/productive-baskets` resource provides basket listing and detail, participant positions, formation, admission decisions, contributions, closing, performance records, distributions, and governed reconstitutions. Write operations require an authenticated session and enforce the active operating tier.
