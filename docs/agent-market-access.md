# Agent Market access

The administrator opens **Agent → Agent Market**, registers or synchronizes an agent in **Workforce**, and issues a credential with `MARKET_READ`, `PROPOSAL_PREPARE`, or both. The credential is shown once. The stored grant contains only a hash of its secret. Grants expire within 30 days and can be revoked. Pausing the agent suspends its access; resuming restores unexpired, unrevoked grants.

The interface is loaded on first use and does not perform market execution:

| Method | Path | Required scope | Result |
| --- | --- | --- | --- |
| GET | `/api/agent-market/capabilities` | `MARKET_READ` | Machine-readable operation list |
| GET | `/api/agent-market/catalog` | `MARKET_READ` | Selected public fields from live, unblocked listings |
| POST | `/api/agent-market/proposals` | `PROPOSAL_PREPARE` | Persisted exact-terms proposal for admin review |

Requests carry `Authorization: Bearer <issued credential>`. Proposal JSON includes `listingId`, `quantity`, `recipientId`, `settlementRoute`, `considerationUnit`, `limitPrice`, `maximumFees`, and a future ISO 8601 `expiresAt`. The server binds the proposal to the credential's agent ID. The admin review endpoint checks the terms hash and current listing before marking it `APPROVED_FOR_HANDOFF`; this state leaves `executionAuthorized: false` and does not submit a market order, move value, issue an instrument, or sign a transaction.

Grant management is available only in the private admin session under `/api/admin/agent-workforce/market/grants`. The access router returns `Cache-Control: no-store`. Audit events record issuance, revocation, and proposal preparation without storing the bearer secret.
