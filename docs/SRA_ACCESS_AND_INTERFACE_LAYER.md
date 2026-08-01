# SRA Access & Interface Layer

## Governing Rule

Users see the verified opportunity and the actions available to their active role. Institutional staff see the evidence, custody, accounting, filing, and control mechanisms behind it.

## Interface Shells

### Public Marketplace

Public visitors may view sanitized opportunity summaries, Verified Value totals, project stage, region, participation window, productive signal, and projected gain rate. Public APIs do not expose evidence packages, custody records, internal scores, collateral schedules, instrument controls, settlement, setoff, discharge, or filing records.

### Participant Workspace

After authentication, the participant enters an active role context. The current prototype supports Asset Owner, Capital Participant, Service Participant, and Institutional Operator roles. Navigation and available actions are filtered by active role. Deeper panels appear only after the participant engages an authorized asset, project, position, or workflow.

### Institutional Operations

The institutional role retains the complete SRA operations console, including V4V, custody, institutional review, Asset Accounts, Verified Value, projects, True Bills, completion, collateral schedules, settlement, setoff, discharge, and Life Record.

## Session Flow

Public Visitor → Sign Up / Sign In → Participant Session → Active Role → Role Workspace → Object-Level Engagement → Authorized Windows

## Prototype Authentication

The current build uses server-side in-memory users and sessions with HttpOnly SameSite cookies. Passwords are hashed with Node.js scrypt. The build includes demo accounts for visual and workflow testing.

This prototype does not yet provide persistent users, database-backed sessions, email verification, password reset, multifactor authentication, external identity verification, production authorization policies, or durable object-level permission grants.

## Demo Accounts

- Asset Owner: owner@sra.demo / Owner123!
- Capital Participant: capital@sra.demo / Capital123!
- Institutional Operator: operations@sra.demo / Operations123!

## API Boundary

- GET /api/access/public
- GET /api/access/session
- POST /api/access/signup
- POST /api/access/signin
- POST /api/access/signout
- POST /api/access/role

## Next Production Requirements

1. Persistent participant and session database.
2. Email verification and secure account recovery.
3. Multifactor authentication for institutional roles.
4. Object-level authorization policies tied to participant scopes.
5. Audit records for sign-in, role switching, record access, and sensitive actions.
6. Separation of public, participant, and institutional API authorization middleware.
7. Staff provisioning and institutional approval workflow.
