# Unified Financing Workflow

SRA financing has one authoritative lifecycle. Supporting funding, verification, value, instrument, marketplace, closing, disbursement, settlement, and servicing services may create their own domain records, but they are not independent financing workflows and must not be treated as the source of truth for the financing stage.

## Authoritative stages

1. APPLICATION
2. UNDERWRITING
3. DECISION
4. CLOSING
5. READY_TO_FUND
6. FUNDED
7. SERVICING
8. CLOSED

The authoritative field is `FUNDING_OPPORTUNITY.financingStage`.

## Workflow authority rule

Only `FinancingLifecycleService` may advance `financingStage`.

Subordinate services may continue to maintain local record statuses that describe the state of that supporting record. Those statuses do not define the overall financing lifecycle.

Legacy `status` and `fundingPhase` fields remain readable for compatibility while callers are migrated, but they are not the authoritative answer to “where is this financing right now?”

## Stage ownership

- APPLICATION: applicant and opportunity intake, including supporting documents and evidence.
- UNDERWRITING: financing analysis and review.
- DECISION: the credit/financing decision and approved terms.
- CLOSING: documents, conditions and closing preparation.
- READY_TO_FUND: closing complete and funding instruction authorized for execution.
- FUNDED: settlement/disbursement confirmed.
- SERVICING: active post-funding administration.
- CLOSED: paid off, withdrawn, declined, cancelled or otherwise terminated.

## Marketplace rule

Marketplace publication, commitments, allocation, participation, and secondary-market activity are optional capabilities attached to a financing or financed position. They are not required stages in the core financing lifecycle and may not advance the core lifecycle independently.

## Migration rule

Existing services are migrated by removing direct writes that use `FUNDING_OPPORTUNITY.status` or `fundingPhase` as cross-service handoff mechanisms. Their local records remain available for audit and operational detail. Cross-stage advancement is routed through `FinancingLifecycleService.transition()`.
