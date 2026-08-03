# Phase 19 — Platform Ledger

## Purpose

Phase 19 records SRA economic events as balanced double-entry accounting entries rather than isolated operational records.

```text
Fee Charge
-> Fee Invoice
-> Accounts Receivable / Fee Revenue
-> Payment Received
-> Cash / Accounts Receivable
```

## Persistent Records

```text
LEDGER_ACCOUNT
LEDGER_ENTRY
```

## Seeded Chart of Accounts

```text
1000-CASH           Operating Cash
1100-AR             Accounts Receivable
4100-FEE-REVENUE    Platform Fee Revenue
4190-FEE-WAIVERS    Fee Waivers and Concessions
```

## Entry Controls

- At least two ledger lines are required.
- Every line references an active Ledger Account.
- Each line contains either a debit or a credit, never both.
- Total debits must equal total credits before posting.
- Posted entries preserve the originating reference type, reference ID, event type, description, currency, actor, and timestamp.
- Unbalanced entries are rejected.

## Fee Economics Integration

Creating a Fee Invoice automatically posts:

```text
Debit  Accounts Receivable
Credit Platform Fee Revenue
```

Recording an invoice payment posts:

```text
Debit  Operating Cash
Credit Accounts Receivable
```

Waiving an already invoiced fee posts:

```text
Debit  Fee Waivers and Concessions
Credit Accounts Receivable
```

A fee waived before invoicing does not create a receivable and therefore does not post an accounting entry.

## Balances and Trial Balance

The service calculates account debits, credits, ending balance, and balance direction from posted entries. The trial balance aggregates all active ledger accounts and reports total debits and credits.

## API

Base path:

```text
/api/ledger
```

Endpoints:

```text
GET  /accounts
POST /accounts
GET  /accounts/:accountId
GET  /accounts/:accountId/balance
GET  /entries
POST /entries
GET  /entries/:entryId
GET  /trial-balance
POST /invoice-payments
```

## Boundary

Phase 19 is the SRA platform operating ledger. It does not yet constitute a complete regulated-bank general ledger, customer deposit subledger, regulatory call-report system, tax ledger, or GAAP financial statement package. Those require additional account structures, posting policies, period controls, reconciliation, close procedures, and reporting rules.
