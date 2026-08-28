# Phase 5 Admin Status

`CounterpartyOperationsStatusService` projects transaction-bound Phase 5 cases for administrator consumers without introducing a second workflow. Per funding package it reports case count, response count, open exception count, authority-wait count, latest response, and one of:

- `AWAITING_COUNTERPARTY_REQUEST`
- `COUNTERPARTY_OPERATIONS_ACTIVE`
- `EXCEPTION_RESOLUTION_ACTIVE`
- `AWAITING_AUTHORITY`

The projection is read-only. Existing admin surfaces may consume it alongside the unified operations queue while the financing lifecycle remains authoritative.
