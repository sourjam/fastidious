# FAS-004 — D1 schema, migrations, authentication, and repositories

**Status:** Closed

## Objective

Create the authoritative D1 schema and server-only persistence layer required by identity, sync, push, and expiration tickets. Use raw prepared SQL and checked-in migrations; do not add an ORM.

## Dependencies

FAS-001 and FAS-002.

## Cloudflare binding

Add a typed `DB` D1 binding to local configuration and a placeholder production binding configuration. Local development and tests must use isolated local D1 state.

The database location hint for eventual creation is North America. Do not put a real production database ID into example/local configuration.

## Migration design

Create sequential SQL migrations, beginning with the complete v1 schema. Include foreign keys, unique constraints, check constraints where D1 SQLite supports them, and indexes matching actual queries.

### Required tables

Implement the logical tables from the parent spec:

- `logs`
- `fasts`
- `weights`
- `push_subscriptions`
- `notification_jobs`
- `mutation_receipts`
- `changes`
- `expired_logs`

Use integer epoch milliseconds. Use text UUIDs/internal IDs. Represent booleans as constrained integers.

### Required indexes

At minimum:

- unique `logs.secret_digest`
- `logs.expires_at`
- unique/transactional one-active-fast invariant per log
- `fasts(log_id, start_at)` and revision/deleted lookup
- `weights(log_id, measured_at)` and revision/deleted lookup
- unique `mutation_receipts(log_id, mutation_id)`
- unique `changes(log_id, revision)`
- `changes(log_id, revision)` range retrieval
- unique push endpoint or `(log_id, device_id)` as appropriate
- `notification_jobs(status, due_at)`
- unique `(fast_id, kind)` for notification jobs
- `expired_logs` lookup and purge indexes

If D1 does not support a desired partial unique index, enforce the one-active-fast rule in a transaction and document the tradeoff.

## Secret digest

Provide a server-only digest function:

- accepts only the canonical base64url token format;
- combines it with an optional server pepper from Worker secrets;
- uses Web Crypto available in Workers;
- returns a fixed canonical encoding;
- never logs input or output;
- has deterministic unit tests using non-production fixtures.

A 256-bit random secret is already brute-force resistant; the pepper is defense-in-depth, not user recovery.

## Repository boundaries

Create narrow server repositories rather than embedding SQL in routes:

### `logRepository`

- create log with digest/preferences/expiration
- authenticate and touch last access
- rotate digest atomically
- increment credential/data generations
- return public metadata without digest
- expire/delete a log transactionally

### `fastRepository`

- list current snapshot including tombstones as needed
- insert/update/delete fast
- enforce overlap and active-fast rules transactionally
- query active fast

Server validation must repeat critical invariants even if the client validated first.

### `weightRepository`

- snapshot and mutations
- canonical kg validation
- tombstone deletion

### `changeRepository`

- allocate/increment per-log revisions without lost updates
- append change payload/tombstone
- fetch deltas after cursor
- determine when a full snapshot is required

### `mutationRepository`

- check/record idempotency receipt
- apply batch in order

Push and cleanup repositories may be skeletal until FAS-014/FAS-015, but schema and typed row mappings must exist.

## Transaction pattern

D1 transaction support differs from traditional SQLite clients. Choose and document a safe pattern based on the current API (for example, ordered `batch` operations where sufficient or a Durable transaction API if exposed). Do not claim atomicity that the selected D1 API cannot provide.

Critical transitions requiring atomic behavior:

- log creation;
- revision allocation plus entity write plus change append plus mutation receipt;
- secret rotation;
- generation reset;
- notification claim;
- expiration cleanup of a log.

If an operation cannot be made atomically with direct D1 primitives, redesign the statement sequence to be idempotent and recoverable.

## Validation and errors

Map repository outcomes to stable errors:

- unauthorized/revoked
- expired
- not found
- generation mismatch
- validation failure
- overlap
- active-fast conflict
- transient database failure

Do not expose SQL text or internal IDs in API errors.

## Test plan

Use isolated local D1/Miniflare integration tests where feasible. Minimum tests:

1. Migrations apply from an empty database.
2. Secret digest lookup authenticates the correct token and rejects another.
3. Duplicate mutation receipt is idempotent.
4. Revision and change row advance together.
5. A second active fast cannot coexist after conflict handling.
6. Overlapping completed intervals are rejected.
7. Deletion creates a tombstone/change.
8. Expiration index query returns only due logs.

## File plan

```text
migrations/0001_initial.sql
lib/server/bindings.server.ts
lib/server/crypto.server.ts
lib/server/db.server.ts
lib/server/repositories/logs.server.ts
lib/server/repositories/fasts.server.ts
lib/server/repositories/weights.server.ts
lib/server/repositories/changes.server.ts
lib/server/repositories/mutations.server.ts
lib/server/errors.server.ts
lib/server/**/*.test.ts
```

## Acceptance criteria

- Empty local D1 migrates successfully.
- Repositories are server-only and typed.
- Routes do not need to write raw SQL later.
- Required indexes match sync, push, and cleanup query shapes.
- Secret plaintext cannot be retrieved from D1.
- Atomicity/idempotency assumptions are documented and tested.
- No ORM is installed.

## Out of scope

HTTP routes, Dexie, full sync orchestration, push delivery, cleanup scheduler, and UI.

## Completion note

Completed 2026-10-30. Added the complete v1 D1 migration, placeholder typed `DB` binding, canonical Worker Web Crypto secret digest, stable repository errors, typed log/fast/weight/change/mutation repositories, and skeletal typed push/cleanup queries. Revision-bearing entity writes and receipts use ordered transactional D1 batches; database triggers and a partial unique index protect overlap and one-active-fast races. The transaction pattern and North America production creation hint are documented in `lib/server/README.md`.

Validation evidence: `npx wrangler d1 migrations apply DB --local --config /tmp/fastidious-fas004-wrangler.jsonc --persist-to /tmp/fastidious-fas004-wrangler` applied `0001_initial.sql` to a fresh isolated local D1 instance (22 commands); `npm test` passed 12 files / 44 tests, including 14 new server tests; `npm run typecheck` passed; `npm run build` passed with existing Vinext sourcemap/dynamic-import warnings; and `git diff --check -- .` passed. No UI changed, so Chrome comparison was not applicable.
