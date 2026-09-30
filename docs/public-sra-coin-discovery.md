# Public SRA Coin discovery

The canonical human page is `/sra-coin.html`. It is linked from the home page and listed in `/sitemap.xml` and `/robots.txt`. It contains static HTML and structured data so a crawler can read the basic identity without running JavaScript. The public JSON profile is `GET /api/public/coin/sra` and permits cross-origin read access.

The profile selects verified SRA Coin positions and their linked instruments, live unblocked listings, and on-chain assets linked to those instruments. It publishes asset code, network, address, issuance state, and recorded market routes. It excludes owner accounts, source accounts, bearer credentials, and private proposal details. An empty array means that no matching record is presently published; it is not a claim of on-chain issuance or market liquidity.

This makes SRA's identity and recorded routes accessible without an agent credential. Search indexing and third-party directory inclusion depend on external crawlers and directory policies. The credentialed agent catalog and admin approval boundary remain separate.
