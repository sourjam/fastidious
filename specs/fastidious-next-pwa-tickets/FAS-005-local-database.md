# FAS-005 — Dexie local database and mutation queue

**Status:** Closed

## Objective

Create the browser-local source of immediate UI state. Every supported write must update local records and append an idempotent sync mutation in one IndexedDB transaction, including while offline.

## Dependencies

FAS-001 and FAS-002.

## Constraints

- Use Dexie; do not wrap it in a second generic repository framework.
- Support one active log per browser/PWA.
- Keep the schema capable of replacing that log after opening another secret.
- Never store the secret inside ordinary domain rows or mutation payloads.
- UI reads from IndexedDB, not from API response caches.

## Schema

Define a versioned Dexie database with tables for:

- `meta` — active log metadata, device ID, cursor, server/data/credential generations, schema state
- `fasts` — local fast records including revision/deleted state
- `weights` — local weight records
- `preferences` — synced log settings
- `mutations` — ordered pending/in-flight mutations
- `preImportBackup` — at most one bounded replacement backup

Useful indexes include fast start/end, weight measurement time, mutation status/sequence, and entity IDs. Avoid duplicating derived calendar/statistics data.

## Device and mutation identity

- Generate one stable random `deviceId` per local database lifecycle.
- Generate UUID mutation IDs before the transaction.
- Give mutations a monotonic local sequence so order is deterministic.
- Mutation status: `pending | sending`; reset stale `sending` rows to `pending` at startup.
- Do not delete acknowledged mutations until the server returns their IDs.

## Local transaction API

Implement explicit operations rather than a generic CRUD abstraction:

- `startFast`
- `editActiveFast`
- `endFast`
- `resumeFast`
- `upsertPastFast`
- `deleteFast` / `restoreFast`
- `addWeight`
- `deleteWeight` / `restoreWeight`
- `updatePreferences`
- `replaceFromImport`
- `clearData`

Each operation:

1. validates with FAS-002 domain rules;
2. opens one Dexie transaction covering affected domain tables and `mutations`;
3. writes the optimistic local state;
4. appends a mutation carrying the current `dataGeneration`;
5. returns a small result for the UI.

If mutation creation fails, the domain write must roll back.

## Active fast

Represent active fasts in the same `fasts` table with `endAt: null`. Enforce the single-active rule in local operations. Starting a new active fast while one exists returns a domain error rather than silently replacing it during ordinary UI usage.

## Applying server state

Implement one transaction that can:

- acknowledge mutation IDs;
- apply ordered server changes;
- update cursor/generations;
- replace a full snapshot;
- discard queued mutations from an obsolete data generation;
- preserve newer pending local mutations when safe.

Server changes must not create duplicate rows. Tombstones remove or mark local rows consistently.

## React integration

Expose small hooks/selectors after the persistence API is stable:

- active fast
- completed fast list/range
- weights
- preferences
- pending mutation count/error

Use Dexie's reactive query support directly or through thin hooks. Do not mirror the entire database in React context or Redux.

## Undo behavior

Deletion/end Undo must be a new compensating local operation/mutation, not an attempt to erase history from an in-flight batch. This keeps sync idempotent when the original action already reached the server.

## Database reset

Provide distinct operations:

- `replaceActiveLog` — erase current local domain/sync data, install new log metadata and snapshot
- `revokeAndErase` — erase everything including remembered secret metadata
- `removeFromDevice` — same local erasure after best-effort push unsubscribe

Closing/deleting the Dexie database must handle open tabs via a documented `BroadcastChannel` message.

## Test plan

Use `fake-indexeddb`. Minimum integration tests:

1. Starting a fast writes the fast and mutation atomically.
2. A thrown mutation write rolls back the fast write.
3. Restart resets stale `sending` mutations to `pending`.
4. Applying the same server change twice is idempotent.
5. Acknowledgement removes only acknowledged mutations.
6. A generation reset discards old rows and mutations.
7. Undo produces a compensating mutation.
8. Only one active fast can exist locally.

Avoid tests for Dexie itself.

## File plan

```text
lib/local-db/database.ts
lib/local-db/schema.ts
lib/local-db/operations.ts
lib/local-db/apply-server-state.ts
lib/local-db/hooks.ts
lib/local-db/reset.ts
lib/local-db/*.test.ts
```

## Acceptance criteria

- Offline operations commit immediately without network access.
- Domain record and mutation queue writes are atomic.
- Data generation resets are safe.
- React can subscribe without duplicating the database in global state.
- Secrets never appear in rows exported as domain data.
- Tests remain short and human-readable.

## Out of scope

Network sync, secret bootstrap, UI screens, and service-worker caches.

## Completion note

Completed 2026-10-30. Added the versioned Dexie local database, stable device and ordered mutation identities, atomic explicit fast/weight/preferences/import/clear operations, compensating Undo mutations, startup recovery for stale sending rows, transactional server-state/snapshot application, generation reset handling, thin reactive React selectors, and documented cross-tab reset behavior. Credentials remain outside domain and mutation rows.

Validation evidence: `npm test -- lib/local-db/local-db.test.ts` passed 11 focused integration tests covering atomic writes and rollback, startup recovery, idempotent server changes, selective acknowledgement, generation reset, deletion/end Undo, single-active enforcement including racing starts, and credential-free exported rows; `npm test` passed 13 files / 55 tests; `npm run typecheck` passed; `npm run build` passed with the existing Vinext sourcemap/dynamic-import warnings; and `git diff --check -- .` passed. No UI changed, so Chrome comparison was not applicable.