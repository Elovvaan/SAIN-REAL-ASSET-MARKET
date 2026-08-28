# Phase 5 Transaction Access Boundary

Phase 5 conversational endpoints remain behind the existing transaction participation gateway authentication. The caller must present the package reference, participation window identifier, and valid access code before the gateway exposes or resolves transaction communication.

The counterparty operations service never broadens the participation window's scope. It resolves only the funding package attached to the authenticated event. Responses contain operational guidance derived from that package and do not expose unrelated transactions.
