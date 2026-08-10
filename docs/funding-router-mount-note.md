# Funding router mount correction

The funding extension routers are created with paths relative to their API prefixes (for example `/dashboard` inside the funding operations router). `server.js` now mounts each funding router with Express `use(prefix, router)` semantics before the existing dispatcher invokes it, so requests such as `/api/funding-operations/dashboard` are matched as `/dashboard` by the child router.

This applies consistently across funding intake, verification, value preparation, model selection, instrument selection/review/issuance, marketplace funding stages, funding operations, and financing closing.
