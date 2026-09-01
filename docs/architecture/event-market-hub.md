# SRA Event Market Hub

The Event Market Hub is a distinct SRA market lane for evidence-controlled binary event contracts. It does not merge event outcomes with Productive Basket performance, asset appreciation, or reference-market observations.

## Contract model

- Every market has exactly one YES contract and one NO contract.
- Contract prices must be below SRA/USD 1.00 and approximately complementary when listed.
- A correct contract settles at SRA/USD 1.00; an incorrect contract settles at zero.
- A VOID determination returns recorded contract cost basis under the initial rule set.
- SRA does not fabricate executions. A position can open only after an authorized venue adapter confirms the execution.

## Lifecycle

`DRAFT → REVIEWED → OPEN → SUSPENDED/CLOSED → RESOLVED → SETTLED`

1. A permitted market author records an unambiguous question, schedule, resolution authority, and resolution rule.
2. An Institutional Operator or Platform Administrator reviews the rulebook, participant eligibility, and rationale.
3. A Platform Administrator records the authorized venue listing and initial YES/NO prices.
4. A venue-confirmed execution debits the participant's SRA/USD Direct Value Account and creates the event position.
5. An authorized operator may suspend, reopen, or close trading with evidence.
6. A Platform Administrator records the final YES, NO, or VOID determination against the published source.
7. Settlement credits winning positions pro rata at exactly SRA/USD 1.00 per contract and closes every open position.

## Boundaries

- The participant interface may display venue prices, rules, exposure, and positions, but it cannot claim an execution without a connector confirmation.
- Resolution source, rule, evidence, and determination rationale are persistent records.
- Venue execution references and settlement references are idempotent.
- Event-market records remain separate from Productive Basket contributions and distributions.

## API

`/api/event-markets` exposes market discovery, participant positions, drafting, review, venue listing, venue-confirmed execution intake, market controls, resolution, and settlement. Operating-tier checks protect every governed stage.
