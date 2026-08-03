# Phase 17 — Treasury Bank Connector

## Purpose

Phase 17 converts an approved SRA Settlement Rail Instruction into an API-driven corporate treasury payment order for submission to a connected commercial bank.

```text
SRA Settlement Engine
-> Settlement Rail Instruction
-> Treasury Payment Order
-> Internal Approvals
-> Bank Treasury API / Host-to-Host Channel
-> Bank Status Messages
-> Rail Evidence
-> SRA Reconciliation
-> Statement Feed
```

## Persistent Records

```text
TREASURY_BANK_CONNECTION
TREASURY_PAYMENT_ORDER
TREASURY_STATEMENT
```

## Bank Connection Profile

A profile records the bank customer reference, API or host-to-host profile, authentication reference, payment-submission endpoint, status endpoint, optional statement endpoint, authorized originating accounts, approved beneficiaries, currency, payment limits, and approval rules.

Credentials and secrets are represented only by secure external references. They are not stored directly in these records.

## Payment Controls

- Payment amount must equal the linked rail instruction.
- Originating account must be authorized.
- Beneficiary must be approved when a beneficiary allowlist exists.
- Single-payment and daily limits are enforced.
- Required internal approvals are enforced before submission.
- Duplicate approver use is blocked.
- Bank transaction references are required for operational bank statuses.
- Network references are required for execution and reconciliation.
- Rejections, returns, and exceptions require reason codes.
- Bank statuses update the linked Settlement Rail Instruction.
- Dispatch is not treated as execution or reconciliation.

## Treasury Payment Lifecycle

```text
PENDING_APPROVAL
-> APPROVED
-> SUBMITTED
-> ACCEPTED
-> PROCESSING
-> EXECUTED
-> RECONCILED
```

Exception states:

```text
REJECTED
RETURNED
EXCEPTION
CANCELLED
```

## Statement Feed

The connector ingests bank statement or account-reporting records with source references, balances, entries, and a statement hash for later matching and reconciliation.

## API

```text
/api/treasury/connections
/api/treasury/connections/:connectionId
/api/treasury/connections/:connectionId/exceptions
/api/treasury/payments
/api/treasury/payments/:paymentOrderId
/api/treasury/payments/:paymentOrderId/approve
/api/treasury/payments/:paymentOrderId/submit
/api/treasury/payments/:paymentOrderId/status
/api/treasury/statements
```

## Integration Boundary

This phase implements SRA's treasury-management workflow and connector contract. It does not claim a live bank API connection until a commercial bank supplies approved credentials, endpoints, accounts, limits, callback/status delivery, and statement-reporting access under its treasury agreement.
