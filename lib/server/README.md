# Server persistence

These modules are Worker-only boundaries around raw prepared D1 SQL. Routes should call repositories rather than prepare SQL themselves.

## Transactions and revisions

D1 does not expose a general callback transaction through `D1Database`. The repositories use `D1Database.batch()`, whose statements execute sequentially as one transaction and roll back together if a statement fails. Revision-bearing writes increment `logs.revision`, write the entity, append `changes`, and optionally insert `mutation_receipts` in the same batch. Entity statements select the new revision from `logs` inside SQL, so application code never allocates a revision from a stale read.

Database constraints remain the final concurrency guard. A partial unique index enforces one live active fast per log, and insert/update triggers reject overlap. Repository preflight validation exists to return stable domain errors; constraints protect races after that check.

`MutationRepository.applyBatch()` processes the supplied order. Its handler must pass the mutation ID to a fast, weight, or change repository so that entity write and receipt share the repository batch. A handler that does not persist that receipt is rejected.

## Synchronization

`POST /api/sync` authenticates before parsing a bounded protocol-v1 batch. Each accepted mutation writes its entity, revision, change row, optional notification-hook statements, and receipt in one D1 batch. A duplicate mutation ID returns its existing receipt without changing state. Competing active-fast starts atomically tombstone the prior active fast and install the last-arriving start with two ordered revisions.

The client marks a bounded queue slice as sending, applies acknowledgements and server state in one Dexie transaction, and returns rows to pending after transient failure. Foreground coordination uses Web Locks when available and a short local-storage lease plus `BroadcastChannel` otherwise. Payloads and health-record identifiers are not logged.

## Configuration and migrations

`cloudflare.config.ts` contains a non-production placeholder D1 ID. Replace it only when creating the production database, using Cloudflare's North America (`nam`) location hint. Local tools must use their own persisted directory or ephemeral database and must never point at production.

Migrations are sequential files under `migrations/`. The integration tests apply the migration to a fresh isolated SQLite database through a small D1-compatible test adapter. Release validation also applies the checked-in migration to a fresh local Wrangler D1 instance, which exercises Cloudflare's actual migration runner.
