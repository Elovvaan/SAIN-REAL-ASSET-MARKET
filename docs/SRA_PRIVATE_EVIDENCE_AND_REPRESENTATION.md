# SRA Private Evidence and Digital Representation Flow

## Core Rule

The source document, its stored digital copy, the institutional verification record, the Verified Value result, the financial instrument, and any blockchain or public marketplace representation are separate but linked objects.

```text
Tangible Source Document
        ↓
Private Digital Evidence Record
        ↓
Submitter Attestation
        ↓
Institutional Verification
        ↓
Verified Value Baseline / Package
        ↓
Authorized Instrument or Digital Representation
        ↓
Public Marketplace View
```

## 1. Private Evidence Record

The uploaded source file remains private and restricted. SRA records:

- private document ID;
- original filename;
- document type;
- MIME type;
- file size;
- SHA-256 integrity hash;
- upload timestamp;
- uploader context;
- review state;
- evidence package linkage.

The public application must not serve the underlying file through its static public directory.

## 2. Submitter Attestation

Submission means only that the participant is presenting the document and related statements for review. It does not mean the asset or document has been institutionally verified.

Initial state:

`SUBMITTER_ATTESTED`

## 3. Institutional Verification

Institutional verification is a downstream workflow performed by an authorized reviewer. Possible states include:

- `INSTITUTIONAL_REVIEW_PENDING`
- `MORE_EVIDENCE_REQUIRED`
- `INSTITUTIONALLY_VERIFIED`
- `REJECTED`
- `RESTRICTED`

Only an authorized institutional workflow may move the evidence package into `INSTITUTIONALLY_VERIFIED`.

## 4. Verified Value

Verified Value begins after institutional verification. The Verified Value Package references the evidence package and institutional verification record, but does not expose the underlying private documents publicly.

## 5. Instrument and Digital Representation

A True Bill, participation position, token, credential, or other digital representation may be created only through its own authorized workflow. It is derived from verified records and is not the source document itself.

## 6. Public Representation

The public marketplace may display approved derived information such as:

- asset identity or approved summary;
- verification state;
- Verified Value dimensions;
- proof or anchor state;
- instrument identifier and lifecycle state;
- projected completion results;
- pool or participation position.

Private source files, private ownership evidence, reviewer notes, and restricted institutional findings remain unavailable to unauthenticated public users.

## Railway Storage

The application reads the private storage root from:

`SRA_PRIVATE_DOCUMENT_ROOT`

For durable Railway storage, mount a Railway Volume and set this variable to the mounted directory, for example:

`SRA_PRIVATE_DOCUMENT_ROOT=/data/sra-private-documents`

Without a mounted persistent volume, the default `/tmp/sra-private-documents` location is suitable only for prototype testing and may be cleared when the service restarts or redeploys.
