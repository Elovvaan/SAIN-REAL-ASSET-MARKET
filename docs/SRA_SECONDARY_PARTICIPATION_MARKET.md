# SRA Secondary Participation Market

## Governing rule

SRA financing is completed independently of marketplace participation.

```text
Opportunity
→ SRA financing decision
→ Closing and funding
→ SRA financed position
→ Servicing
```

No participant, commitment, marketplace listing, allocation, participation agreement, or secondary-market settlement is required to originate, fund, activate, or service the financing.

Only after a financed position exists may SRA separately authorize some or all of that position for distribution:

```text
SRA financed position
→ Position distribution authorization
→ Marketplace preparation
→ Publication
→ Participant commitment
→ Allocation
→ SRA Secondary Participation Agreement
→ Settlement
→ Participant position active
```

## SRA Secondary Participation Agreement

The agreement is the durable contractual record linking an allocated marketplace position to the already-existing financed position before secondary settlement occurs.

The agreement records:

- financed position ID;
- distribution authorization ID;
- marketplace listing ID;
- allocation and commitment references;
- participant ID;
- participation quantity;
- purchase amount and currency;
- SRA as transferor of the allocated position;
- SRA as servicer unless servicing is separately transferred;
- participant acceptance;
- SRA execution;
- transfer restrictions and disclosures;
- agreement lifecycle state.

The agreement explicitly records that the underlying financing obligation is unchanged by the secondary transaction and that participant involvement has no dependency relationship to origination or funding.

## Guaranty boundary

The SRA Secondary Participation Agreement is not an SBA Form 1086 and does not create or imply a United States government guaranty, SBA guaranty, or automatic SRA repayment guaranty.

The default record state is:

```text
guarantyStatus = NO_SRA_OR_GOVERNMENT_REPAYMENT_GUARANTY
creditEnhancement = NONE_UNLESS_SEPARATELY_DOCUMENTED
```

Any future guaranty or credit-enhancement product must be separately documented and must not be inferred from participation ownership.

## Agreement lifecycle

```text
DRAFT
→ participant acceptance
→ AWAITING_SRA_EXECUTION
→ SRA execution
→ EXECUTED
→ settlement preparation permitted
```

Settlement preparation is blocked until an executed agreement matches the marketplace position, participant, and financed position.

## API

```text
GET  /api/funding-marketplace-allocation/participation-agreements
GET  /api/funding-marketplace-allocation/participation-agreements/:agreementId
POST /api/funding-marketplace-allocation/positions/:positionId/participation-agreements
POST /api/funding-marketplace-allocation/participation-agreements/:agreementId/participant-acceptance
POST /api/funding-marketplace-allocation/participation-agreements/:agreementId/execute
POST /api/funding-marketplace-allocation/positions/:positionId/settlement-preparation
```

The final endpoint requires the position's matching secondary participation agreement to be executed.
