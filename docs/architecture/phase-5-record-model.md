# Phase 5 Record Model

`COUNTERPARTY_OPERATION_CASE` is the governed case record. It binds the source participation event, funding package, financing transaction, classified topic, authority requirement, status, and next action.

`COUNTERPARTY_OPERATION_RESPONSE` is the persisted agent response. It binds the response to the case and source event and records the Phase 2 unresolved-field state and Phase 4 outcome status used when the answer was produced.

IDs are deterministic from the funding package and source event, making retries and process restarts idempotent.

A response record is an operational communication record. It does not itself authorize financing, settlement, external transfer, instrument issuance, ownership transfer, or payment, and it does not itself prove an external outcome.
