# Phase 5 FedEx Transaction Test Path

Use the FedEx financing transaction as an end-to-end operational test after Phase 5 is deployed.

1. Create or select the financing export package and complete Phase 2 context reasoning.
2. Execute eligible Phase 3 preparation so the current funding package and participation window exist.
3. Provide the counterparty the package reference and participation access code.
4. Counterparty confirms receipt and identifies its processing contact.
5. Counterparty submits an ACH, instrument, package, or processing clarification through the transaction participation window.
6. Phase 5 records the question, loads the exact transaction context and Phase 4 state, persists a governed case, and returns the transaction-grounded response.
7. If the counterparty reports a blocker, Phase 5 records an exception case and identifies the governed next step without changing financing terms or settlement state.
8. If the counterparty requests a protected change or authorization, the case stops at `AWAITING_AUTHORITY` for principal action.
9. Counterparty submission/processing confirmation remains external evidence. Phase 4 independently reconciles the actual external result.
10. The transaction proceeds to Phase 6 only from resolved cases and the applicable verified outcome state.
