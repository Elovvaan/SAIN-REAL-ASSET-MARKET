# SRA Stellar Anchor Platform

This directory connects the official Stellar Anchor Platform to SRA as its business system. Start with Testnet. The Stellar quick-run reference business server is not a production SRA service.

## Runtime boundary

- Anchor Platform SEP server: public wallet-facing SEP-10/SEP-24 service.
- Anchor Platform platform server: private transaction-state API.
- SRA application: authenticated business event receiver and authoritative Treasury/settlement records.
- PostgreSQL/Kafka: operated with the Anchor Platform deployment as required by its architecture.

## SRA application variables

```text
SRA_ANCHOR_MODE=TESTNET
SRA_ANCHOR_HOME_DOMAIN=www.sainrealasset.com
SRA_ANCHOR_PUBLIC_URL=https://anchor-testnet.sainrealasset.com
SRA_ANCHOR_SIGNING_KEY=<dedicated Stellar anchor signing public key>
SRA_ANCHOR_USDC_ISSUER=<USDC issuer for the selected Testnet environment>
SRA_ANCHOR_CALLBACK_API_KEY=<at least 32 random bytes>
STELLAR_DISTRIBUTOR_PUBLIC_KEY=<Testnet distribution G-address>
```

Do not reuse a Stellar secret as the callback API key. Testnet and production use separate signing/distribution accounts and separate databases.
Do not place the Circle Mainnet USDC issuer in the Testnet configuration. Promote the asset issuer together with the network environment.

## Anchor Platform callback configuration

```text
CALLBACK_API_BASE_URL=https://www.sainrealasset.com/api/anchor-platform
CALLBACK_API_AUTH_TYPE=api_key
CALLBACK_API_AUTH_API_KEY_HTTP_HEADER=X-Api-Key
SECRET_CALLBACK_API_AUTH_SECRET=<same value as SRA_ANCHOR_CALLBACK_API_KEY>
EVENT_PROCESSOR_CALLBACK_API_REQUEST_ENABLED=true
```

Configure the Anchor Platform transaction event callback as:

```text
POST https://www.sainrealasset.com/api/anchor-platform/events
```

SRA stores a normalized transaction lineage record plus a SHA-256 hash of the received event. Customer PII must remain in SRA's separately authorized customer-information boundary and is not stored by this event endpoint.

## Promotion rule

Production requires HTTPS, a dedicated production signing key, production distribution account, protected private Platform API, production PostgreSQL/Kafka, and completed end-to-end SEP-10/SEP-24 tests. Changing `SRA_ANCHOR_MODE` does not itself promote or migrate Testnet state.
