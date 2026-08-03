# Phase 23 — Balance Sheet and Financial Statements

## Purpose

Phase 23 converts the Platform Ledger into period-based financial statements and explicit accounting-period controls.

```text
Posted Ledger Entries
-> Accounting Period
-> Account Classification
-> Income Statement
-> Balance Sheet
-> Financial Statement Snapshot
-> Explicit Period Close
```

## Persistent Records

```text
ACCOUNTING_PERIOD
FINANCIAL_STATEMENT_SNAPSHOT
```

## Expanded Chart of Accounts

The seeded platform chart now includes:

```text
1000-CASH                    Operating Cash
1100-AR                      Accounts Receivable
2000-AP                      Accounts Payable
3000-CONTRIBUTED-CAPITAL     Contributed Capital
3100-RETAINED-EARNINGS       Retained Earnings
4100-FEE-REVENUE             Platform Fee Revenue
4190-FEE-WAIVERS             Fee Waivers and Concessions
5100-OPERATING-EXPENSE       Operating Expense
```

## Accounting Periods

A period records:

```text
Name
Start date
End date
Currency
OPEN or CLOSED state
Close reference
Closing snapshot
Responsible actors and timestamps
```

Only open periods may be closed. Closing is explicit and preserves the statements generated at close time.

## Income Statement

The income statement calculates:

```text
Gross Revenue
- Contra Revenue
= Net Revenue
- Expenses
= Net Income
```

## Balance Sheet

The balance sheet groups:

```text
Assets
Liabilities
Equity before current-period income
Current-period net income
Total equity
Total liabilities and equity
```

The report exposes whether:

```text
Assets = Liabilities + Equity
```

## Financial Statement Snapshots

A snapshot stores a final copy of the statements for a period without closing the period. This supports review, audit evidence, and comparison before formal close.

## API

Base path:

```text
/api/financial-statements
```

Endpoints:

```text
GET  /periods
POST /periods
GET  /periods/:periodId
GET  /periods/:periodId/statements
POST /periods/:periodId/snapshots
POST /periods/:periodId/close
GET  /snapshots
```

## Boundary

Phase 23 creates management financial statements from the SRA Platform Ledger. It does not claim that the statements are audited, GAAP-compliant, tax-ready, regulatory call reports, or bank regulatory financial statements. Those require accounting policies, opening balances, accrual rules, depreciation, impairment, reconciliations, consolidation, tax treatment, external review, and applicable regulatory reporting standards.
