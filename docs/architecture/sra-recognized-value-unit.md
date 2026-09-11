# SRA Recognized Value Unit and Settlement Equivalence

## Purpose

The SRA Recognized Value Unit (`SRA/RVU`) expresses canonical Verified Value in
a neutral internal accounting unit before any settlement asset or rail is
selected.

`SRA/RVU` is not a currency, token, stablecoin, public-chain asset, payment
rail, instrument, ownership position, or promise of settlement. It does not
replace native `SRA-USD`, full-reserve `SRA_USD`, a Verified Value Package, a
True Bill, a Participation Position, or the Optional Settlement Layer.

## Canonical flow

```text
authorized evidence
  -> frozen Verified Value snapshot
  -> canonical Verified Value Record
  -> SRA/RVU recognition
  -> purpose-bound instrument or position
  -> participant settlement instruction
  -> actual execution
  -> Settlement Equivalence Record
  -> reconciliation
```

## Recognition

Every SRA/RVU Recognition references the immutable canonical Verified Value
Record, determination, snapshot, funding opportunity, and value preparation.
It records:

- recognized SRA/RVU amount;
- original determined value and currency;
- productive-value classification;
- economic-purpose classification;
- deliverability information;
- recognition authority and time; and
- explicit non-creation boundaries.

The initial productive-value classifications are existing asset, available
production, committed production, potential capacity, completed work,
receivable, essential resource, infrastructure capacity, mixed, and
unclassified.

The initial economic-purpose classifications are productive, acquisition,
infrastructure, working capital, settlement, protection, recovery, consumption,
and unclassified. These classifications describe economic purpose without
renaming or changing the legal identity of an instrument.

## Settlement equivalence

A Settlement Equivalence Record is created only after a settlement execution
reference exists. It records the SRA/RVU amount satisfied, actual settlement
asset and quantity, network when applicable, execution and confirmation
references, transaction identifier, pricing source, destination reference, and
settlement time.

The executed quantity does not reprice or rewrite the original recognized
value. Aggregate Settlement Equivalence Records cannot exceed the recognized
SRA/RVU amount for the opportunity.

## Currency equality inside SRA

SRA does not declare or alter sovereign foreign-exchange rates. National
currencies and digital assets remain settlement choices with their exact
identities. SRA/RVU supplies an equal accounting ruler: productive value is
recognized before external currency denomination or asset conversion is
applied. Actual conversion differences remain visible as settlement facts.

## FedEx acquisition path

The existing Phase 5 FedEx transaction remains the end-to-end operational path.
For that acquisition, the funding value preparation may classify the verified
route-contract and operating value as `AVAILABLE_PRODUCTION` with economic
purpose `ACQUISITION`. Completion creates the canonical VVR and linked SRA/RVU
Recognition before LOI, instrument, funding-package, settlement, or processing
records proceed through their existing lifecycles.

No FedEx amount, valuation, term, settlement asset, counterparty decision, or
execution result is manufactured by this architecture. Those values must come
from the authorized transaction record and evidence.
