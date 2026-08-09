# On-Chain Transfer

SRA exposes one generic on-chain transfer intent:

- `asset`
- `amount`
- `destinationAddress`
- `network`

The execution sequence is:

`asset + amount + destination + network → resolve network → resolve asset representation → resolve source → read current network state → build → sign → broadcast → transaction ID → confirm → record`

## Boundary

The generic on-chain layer does not contain network-specific transaction construction, asset-specific hardcoding, fixed transfer amounts, market or venue workflows, special executor services, or test-only execution paths.

Network-specific code belongs under the generic interface in a network adapter. An adapter owns destination validation, asset representation lookup, current network state, transaction construction, fee mechanics, signing mechanics, broadcasting, and confirmation semantics required by that network.

## Asset representation

If the requested asset already exists on the selected network, the adapter resolves that representation and transfers it.

If the asset does not yet have an on-chain representation, representation or issuance is a prerequisite operation. It is not part of the normal transfer transaction and must not be silently invented by the transfer service.

## Transaction state

Broadcasting is not confirmation. A successful broadcast must return a transaction identifier. SRA records the submitted transaction and checks network status until the adapter reports the network-defined confirmation state.

The resulting SRA transfer record preserves the original transfer intent, transaction identifier, current state, and confirmation information.

## Separate concerns

Marketplace activity, settlement choices, participant business rules, asset issuance policy, custody policy, and internal approval processes may exist elsewhere in SRA, but none of them are part of the generic blockchain transfer mechanism unless the caller independently requires those business processes before requesting a transfer.
