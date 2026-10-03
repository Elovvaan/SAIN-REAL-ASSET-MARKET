# Platform pricing, billing, and financing inputs

SRA Administration → Pricing & Billing provides six views: Overview, Schedules, Charges, Invoices, Collections, and Revenue Model.

## Existing prices

| Accepted billable work | USD price |
| --- | ---: |
| Coin operations | 16.50 |
| Listing operations | 18.00 |
| Order operations | 8.67 |
| Settlement operations | 26.25 |
| Export / external transfer | 24.75 |
| Marketplace operations | 17.00 |

The source is the established August 21, 2026 agent-service schedule. Loading that schedule is an explicit administrator action and preserves an existing stored schedule. Accepted work with a linked payer is required for agent-service assessment. No account-subscription price or transaction percentage is invented. Other prices are created as drafts and activated explicitly by an authenticated administrator.

## Billing workflow

1. Load saved catalog items and schedules from persistent storage.
2. Calculate a fee against an effective active schedule or the established explicit-use agent schedule.
3. Assess a fee for a payer and subject; the agent schedule checks actual accepted work and its authoritative quote.
4. Create an invoice containing distinct assessed charges belonging to one payer and currency. Invoice, charge transitions, and the balanced revenue/receivable journal commit together.
5. Record a received fee payment with its amount, currency, external reference, evidence reference, and operating cash account. This records receipt evidence; it does not initiate an external transfer.
6. Receipt, partial/full invoice balance, settled charge states, and cash/receivable journal commit together. Payment references are deduplicated; mismatched retries and overpayments are rejected.

Pricing, payer records, institutional billing, and financial changes require server-validated administrator sessions. Actor headers and body fields do not confer authority. Existing capability-upgrade payment confirmation uses the same receipt service. Institutional billing reuses an identical period and rejects overlapping periods; retries reuse the existing charge and invoice links.

## Reporting and financing

The report reads only the relevant fee, ledger, receipt, instruction, workforce, compensation, and revenue-model record types. It does not need to load the full marketplace operations queue. Record-type-specific identities preserve work orders, compensation records, and receipts that share related entity IDs.

Amounts are grouped by currency and month. Gross assessed fees, gross invoices, waived invoice fees, receipt-backed collections, outstanding invoices, earned compensation, and paid compensation remain separate. A posted payment journal without a matching recorded receipt is flagged rather than counted as a collection. Bank reconciliation and expense completeness remain necessary for a complete financial statement or repayment analysis.

The Revenue Model is tied to the owner's $5,000,000 proceeds target and future SRA business revenue. Administrators may save named monthly work-count scenarios. The service calculates gross charges from the existing schedule, retains missing volumes as null, records schedule provenance, and marks partial coverage. These scenarios are separate from historical cash collections. Collections forecasts and repayment capacity remain unset until assumptions, expenses, and financing terms are developed.

Download financing inputs exports the prices, saved scenarios, historical monthly billing, collections, compensation, and reconciliation limitations as JSON. Highland acquisition forecasts are excluded.

## Verification

Focused API checks cover authentication, prices, invoice validation, restart persistence, typed record identities, payment retries, partial/full payments, overpayment rejection, evidence requirements, receipt/journal reconciliation, capability-upgrade payments, institutional billing retry/overlap prevention, and saved revenue scenarios. DOM checks cover all six views, the payment form payload, and scenario arithmetic. Broader-suite failures were compared against the unchanged mainline baseline; unrelated failures were not reported as passing.
