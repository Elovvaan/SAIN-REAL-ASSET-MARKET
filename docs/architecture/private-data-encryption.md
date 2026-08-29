# SRA private data encryption

## Scope

SRA applies application-controlled authenticated encryption to private document bodies at the private-document storage boundary. Searchable financing and document metadata remain outside this body-encryption boundary so underwriting, record relationships, retention controls, and operational queries continue to function.

Private document bytes follow this path:

`upload bytes -> SHA-256 integrity digest -> extraction/mapping as authorized -> AES-256-GCM body encryption -> private storage`

Reads reverse the body-encryption step only after the existing application authorization path grants access.

## Cryptographic format

`DataEncryptionService` uses AES-256-GCM with a fresh 96-bit IV for each encryption operation. The authenticated-data context contains the private document ID (`PRIVATE_DOCUMENT_BODY:<documentId>`), binding ciphertext to its record so an encrypted body copied to a different document ID fails authentication.

The stored binary envelope contains:

- SRA envelope/version marker (`SRAE1`)
- encryption key ID
- random IV
- GCM authentication tag
- ciphertext

The encryption key itself is never written into the envelope, document metadata, database payload, audit event, or repository.

## Key configuration

Keys are supplied only through the runtime secret environment.

For a single active key:

- `SRA_DATA_ENCRYPTION_KEY`: exactly 32 bytes encoded as base64, or 64 hexadecimal characters
- `SRA_DATA_ENCRYPTION_KEY_ID`: optional identifier; defaults to `primary`

For rotation/keyring operation:

- `SRA_DATA_ENCRYPTION_KEYS`: JSON object whose properties are key IDs and whose values are 32-byte base64 or 64-character hex keys
- `SRA_DATA_ENCRYPTION_ACTIVE_KEY_ID`: key ID used for new encryption operations

Example structure only (not a real key):

`SRA_DATA_ENCRYPTION_KEYS={"v1":"<32-byte-key>","v2":"<32-byte-key>"}`

`SRA_DATA_ENCRYPTION_ACTIVE_KEY_ID=v2`

Never commit an encryption key to the repository.

## Existing documents

The storage service remains able to read legacy plaintext bodies. When an encryption key is configured, initialization scans existing PostgreSQL private-document bodies and converts plaintext rows to authenticated encrypted envelopes. The corresponding document metadata receives a `bodyProtection` record identifying the algorithm, envelope version, and key ID. A storage-level audit event records the migration count without recording document content or encryption keys.

A legacy plaintext filesystem body encountered while encryption is configured is encrypted in place when accessed.

## Key rotation

Rotation is performed by keeping the previous key in `SRA_DATA_ENCRYPTION_KEYS`, adding the replacement key, and changing `SRA_DATA_ENCRYPTION_ACTIVE_KEY_ID`. Existing envelopes continue to decrypt with their recorded key ID; new writes use the active key. Removing an old key before all envelopes using it have been re-encrypted makes those envelopes unreadable and must not be done.

## Separation of concerns

SHA-256 document hashes continue to provide integrity identity for the original document bytes. AES-256-GCM provides confidentiality and authenticated integrity for the stored private body. Existing SRA session authorization and role controls determine who may reach the read operation. These controls are complementary and are not substitutes for one another.

This boundary does not place financing records, marketplace records, or on-chain public data inside the document-body cipher. Additional field-level encryption, if required, should use this centralized encryption service rather than introducing separate cryptographic implementations into individual financing services.
