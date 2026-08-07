# SRA Export & Settlement — Live Execution Boundary

## What this adds

SRA already records settlement rail adapters, creates durable rail instructions, controls instruction state transitions, and reconciles completed settlement. This implementation adds the provider execution boundary between `READY` and external provider acceptance.

Supported execution configurations:

- ACH provider adapter
- Fedwire or bank-wire provider adapter
- Coinbase settlement provider adapter

SRA does not claim direct access to ACH or Fedwire. The configured endpoint must belong to the bank, correspondent, processor, treasury provider, or other institution that is authorized to submit the payment instruction.

## Execution sequence

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

## Safety controls

- Live mode is disabled by default.
- No provider credentials are stored in the repository.
- Every provider request uses the SRA instruction ID as the idempotency key.
- The operator must provide an exact execution phrase.
- Requests have a configurable timeout.
- Request and response evidence are SHA-256 hashed.
- Provider rejection moves the instruction into `EXCEPTION` rather than pretending settlement occurred.
- The one-dollar canary only accepts an existing instruction for exactly `1.00 USD`.

## Environment variables

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

Coinbase:

```text
SRA_COINBASE_ENDPOINT=https://your-approved-coinbase-transfer-endpoint.example/transfers
SRA_COINBASE_TOKEN=...
# or SRA_COINBASE_API_KEY=...
SRA_COINBASE_ACCOUNT_ID=...
```

The endpoint may be an internal credential-signing gateway. This keeps provider-specific authentication and private keys outside the SRA application process.

## Runtime status

```http
GET /api/settlement-rails/execution/status
```

This returns configuration readiness without exposing secrets.

## Execute a prepared instruction

```http
POST /api/settlement-rails/instructions/{instructionId}/execute
x-sra-actor-id: operator-id
x-sra-live-confirmation: EXECUTE 1.00 USD VIA ACH
content-type: application/json

{}
```

## First one-dollar live canary

Prerequisites:

1. A completed and authorized SRA settlement exists.
2. An active rail adapter exists.
3. A settlement instruction exists for exactly `1.00 USD` and is in `READY` state.
4. The destination is a controlled receiving account or wallet.
5. The correct provider environment variables are installed in the deployment environment.

Execute:

```http
POST /api/settlement-rails/instructions/{instructionId}/execute-one-dollar-canary
x-sra-actor-id: operator-id
x-sra-live-confirmation: EXECUTE 1.00 USD VIA ACH
content-type: application/json

{}
```

After the provider reports execution, independently verify the receiving account and reconcile through the existing state transition:

```http
POST /api/settlement-rails/instructions/{instructionId}/transition
content-type: application/json

{
  "state": "RECONCILED",
  "institutionTransactionReference": "provider-reference",
  "networkReference": "network-reference",
  "receivingConfirmationReference": "receiving-account-confirmation",
  "confirmedAmount": 1.00
}
```

## Production boundary

The code path is live-capable, but no real transfer should be represented as completed until a provider credential, controlled destination, provider response, and receiving-side confirmation all exist. The repository contains no credentials and cannot originate a real payment by itself.
