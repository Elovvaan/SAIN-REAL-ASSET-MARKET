# EDX Stabilization — Priority 1: Provable Pipeline

## Purpose

This stabilization phase makes the existing EDX workflow executable under automated integration tests.

The production application is now created through an exportable app factory. The production server and Supertest both use the same routers and services.

## Test Stack

- Node.js built-in `node:test` runner;
- Supertest HTTP integration testing;
- memory-isolated database by default;
- optional PostgreSQL integration mode through `TEST_DATABASE_URL`;
- deterministic EDX fixtures;
- serial test execution.

## Commands

```text
npm test
npm run test:edx
npm run test:integration
```

To run against PostgreSQL:

```text
TEST_DATABASE_URL=<isolated-test-database-url> npm run test:integration
```

The PostgreSQL URL must identify an isolated test database. The test must not be pointed at production or shared development data.

## Proven Workflow

The end-to-end test executes the live HTTP routes in this order:

```text
Create connector definition
        ↓
Create enterprise connection
        ↓
Authorization pending
        ↓
Connected
        ↓
Active
        ↓
Create extraction policy
        ↓
Activate policy
        ↓
Create extraction request
        ↓
Company approves extraction
        ↓
Submit source data
        ↓
Filter disallowed fields
        ↓
Create immutable extraction result
        ↓
Normalize into SRA record
        ↓
Verify normalized record
        ↓
Generate frozen Verified Snapshot
        ↓
Generate active Verified Value Package
        ↓
Keep Private
        ↓
Prove no marketplace projection exists
        ↓
Publish Today
        ↓
Company approves publication
        ↓
Explicit execution
        ↓
Prove marketplace projection exists
```

## Fixture Protections

The fixture includes private customer fields that are excluded by policy.

The test proves that:

- approved revenue fields persist;
- customer name does not persist in the extraction result;
- customer email does not persist in the extraction result;
- Keep Private creates no marketplace projection;
- Publish Today remains pending until approval;
- execution after approval creates exactly one published marketplace projection;
- the projection carries the company approval reference.

## Application Factory

`app.js` exports:

```text
createApp(options)
```

Supported test options:

- `connectionString` — PostgreSQL test URL or empty for memory isolation;
- `serveStatic` — disable static and catch-all routes during tests;
- `seedMarketplace` — disable marketplace seed data during EDX tests;
- `database` — inject a database implementation;
- `domainStore` — inject an onboarding domain store.

`server.js` only creates the production app and starts the listener.

## Exit Criteria

Priority 1 is implemented when:

- the app can be imported without opening a network port;
- production and tests use the same route composition;
- Supertest exercises the full EDX pipeline;
- memory-isolated integration tests are available;
- PostgreSQL integration mode is available;
- deterministic fixtures are committed;
- private and published outcomes are asserted independently;
- the test commands are declared in `package.json`.

## Verification Boundary

The GitHub connector can commit this test implementation but cannot execute `npm install` or `npm test` inside the repository runtime.

The pull request therefore provides executable proof infrastructure. Passing test results must come from GitHub Actions, a local checkout, Railway build hooks, or another runtime that installs dependencies and runs the declared commands.
