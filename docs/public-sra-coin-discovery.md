# Public SRA Coin discovery

The canonical human page is `/sra-coin.html`. It is linked from the home page and listed in `/sitemap.xml` and `/robots.txt`. It contains static HTML and structured data so a crawler can read the basic identity without running JavaScript. The public JSON profile is `GET /api/public/coin/sra` and permits cross-origin read access.

The profile selects verified SRA Coin positions and their linked instruments, live unblocked listings, and on-chain assets linked to those instruments. It publishes asset code, network, address, issuance state, and recorded market routes. It excludes owner accounts, source accounts, bearer credentials, and private proposal details. An empty array means that no matching record is presently published; it is not a claim of on-chain issuance or market liquidity.

This makes SRA's identity and recorded routes accessible without an agent credential. Search indexing and third-party directory inclusion depend on external crawlers and directory policies. The credentialed agent catalog and admin approval boundary remain separate.

The Stellar issuer identity is published separately at `/.well-known/stellar.toml`. On request, the route hydrates issued on-chain assets and their source Coin Positions. Each confirmed Stellar SRA representation is published with its actual asset code and issuer public key; unissued assets and unrelated positions are excluded. This endpoint works without optional Anchor Platform configuration. It includes the issuer accounts and a public PNG logo route.

An administrator can select **Link Stellar Issuer Domain** on an issued Stellar asset in On-Chain Issuance. The action uses the configured issuer signer to set that issuer account's home domain to `www.sainrealasset.com` and records the transaction. It is idempotent for an already linked account. The same code and issuer pair can then be used in a Stellar wallet or venue asset search and in an application to a curated asset list.
