# Unified Financing Workflow

SRA financing has one authoritative lifecycle. Supporting funding, verification, value, instrument, marketplace, closing, disbursement, settlement, and servicing services may create their own domain records, but they are not independent financing workflows and must not be treated as the source of truth for the financing stage.

## Authoritative stages

1. APPLICATION
2. DOCUMENTATION
3. VERIFICATION
4. UNDERWRITING
5. DECISION
6. CLOSING
7. READY_TO_FUND
8. FUNDED
9. SERVICING
10. CLOSED

The authoritative field is `FUNDING_OPPORTUNITY.financingStage`.

## Workflow authority rule

Only `FinancingLifecycleService` may advance `financingStage`.

Subordinate services may continue to maintain local record statuses that describe the state of that supporting record, such as a verification request being `IN_REVIEW`, a closing condition being `SATISFIED`, or a settlement instruction being `SUBMITTED`. Those statuses do not define the overall financing lifecycle.

Legacy `status` and `fundingPhase` fields remain readable for compatibility while callers are migrated, but they are not the authoritative answer to “where is this financing right now?”

## Stage ownership

- APPLICATION: applicant and opportunity intake.
- DOCUMENTATION: supporting documents, evidence, completeness, remediation.
- VERIFICATION: factual/evidence verification only.
- UNDERWRITING: value analysis, model analysis, structure analysis, instrument preparation and review.
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
