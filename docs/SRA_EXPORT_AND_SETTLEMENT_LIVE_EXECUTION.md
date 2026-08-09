# SRA Export & Settlement — Live Execution Boundary

## Provider settlement rails

SRA records settlement rail adapters, creates durable rail instructions, controls instruction state transitions, and reconciles completed settlement. This execution boundary is only for provider-mediated payment rails.

Supported provider execution configurations:

- ACH provider adapter
- Fedwire or bank-wire provider adapter

Blockchain transfers are intentionally not executed through this provider settlement service. Direct on-chain execution lives under `/api/on-chain` and uses the chain executor, signer, public RPC, and returned transaction signature/hash.

SRA does not claim direct access to ACH or Fedwire. The configured endpoint must belong to the bank, correspondent, processor, treasury provider, or other institution that is authorized to submit the payment instruction.

## Provider execution sequence

```text
AUTHORIZED SRA SETTLEMENT
        ↓
SETTLEMENT RAIL INSTRUCTION: READY
        ↓
Exact operator execution confirmation
        ↓
DISPATCHED
        ↓
Configured provider HTTPS request
        ↓
ACCEPTED or EXECUTED
        ↓
Provider/network confirmation
        ↓
RECONCILED
```

A provider response never automatically creates `RECONCILED`. Receiving-side confirmation is still required through the existing transition endpoint.

## Direct on-chain sequence

The direct chain path does not use the provider settlement executor.

```text
SRA ASSET / COIN
        ↓
DESTINATION ADDRESS + AMOUNT
        ↓
/api/on-chain
        ↓
CHAIN EXECUTOR
        ↓
PUBLIC CHAIN SDK / RPC
        ↓
BUILD TRANSACTION
        ↓
SIGN
        ↓
BROADCAST
        ↓
REAL TRANSACTION SIGNATURE / HASH
        ↓
CONFIRM ON CHAIN
        ↓
RECORD IN SRA
```

The current Solana implementation uses the public Solana SDK path in `external/orca-executor/sra-token-worker.js`: `Connection`, `PublicKey`, `SystemProgram.transfer`, transaction signing, `sendRawTransaction`, and `confirmTransaction`. SPL-token issuance and movement use the public `@solana/spl-token` functions.

No simulated transaction signature is accepted as proof of an on-chain transfer in this execution path.

## Safety controls for provider rails

- Live mode is disabled by default.
- No provider credentials are stored in the repository.
- Every provider request uses the SRA instruction ID as the idempotency key.
- The operator must provide an exact execution phrase.
- Requests have a configurable timeout.
- Request and response evidence are SHA-256 hashed.
- Provider rejection moves the instruction into `EXCEPTION` rather than pretending settlement occurred.
- The one-dollar canary only accepts an existing instruction for exactly `1.00 USD`.

## Environment variables — provider rails

Global:

```text
SRA_SETTLEMENT_EXECUTION_MODE=LIVE
SRA_SETTLEMENT_PROVIDER_TIMEOUT_MS=15000
```

ACH:

```text
SRA_ACH_ENDPOINT=https://your-provider.example/transfers
SRA_ACH_TOKEN=...
# or SRA_ACH_API_KEY=...
SRA_ACH_ACCOUNT_ID=...
```

Fedwire / wire:

```text
SRA_FEDWIRE_ENDPOINT=https://your-bank-or-provider.example/wires
SRA_FEDWIRE_TOKEN=...
# or SRA_FEDWIRE_API_KEY=...
SRA_FEDWIRE_ACCOUNT_ID=...
```

## Environment variables — direct Solana execution

```text
SOLANA_EXECUTOR_ENDPOINT=...
SOLANA_EXECUTOR_TOKEN=...
SOLANA_RPC_URL=...
SOLANA_CLUSTER=devnet|mainnet
SOLANA_PAYER_SECRET_KEY=...
DATABASE_URL=...
```

The SRA application calls the chain executor. The chain executor uses the signer and public Solana RPC to originate the real blockchain transaction and returns the actual transaction signature.

## Runtime status

Provider rails:

```http
GET /api/settlement-rails/execution/status
```

Direct on-chain:

```http
GET /api/on-chain/solana/status
GET /api/on-chain/solana/wallet
GET /api/on-chain/solana/sra
```

## Direct SOL transfer

```http
POST /api/on-chain/solana/transfers
content-type: application/json

{
  "destinationAddress": "<solana-address>",
  "amount": "1"
}
```

The returned `transactionSignature` is the network transaction reference.

## Direct SRA token transfer

```http
POST /api/on-chain/solana/sra/transfers
content-type: application/json

{
  "destinationAddress": "<solana-address>",
  "amount": "1"
}
```

The returned `transactionSignature` is the network transaction reference.

## Execute a prepared provider instruction

```http
POST /api/settlement-rails/instructions/{instructionId}/execute
x-sra-actor-id: operator-id
x-sra-live-confirmation: EXECUTE 1.00 USD VIA ACH
content-type: application/json

{}
```

## Production boundary

Provider settlement and blockchain settlement are separate execution classes.

ACH/Fedwire require an authorized provider endpoint and provider credentials. Direct blockchain transfers require a configured chain executor, signer, RPC endpoint, valid destination address, and sufficient on-chain balance/fees. SRA records completion only from the real external reference returned by the provider or blockchain network.
