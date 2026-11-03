# FAS-007 — Offline synchronization protocol

**Status:** Closed

## Objective

Synchronize Dexie mutations and D1 changes through one explicit, idempotent JSON protocol while preserving instant offline writes and per-record last-arriving-write-wins behavior.

## Dependencies

FAS-004, FAS-005, and FAS-006.

## Protocol

Implement `POST /api/sync` with a shared runtime-validated contract.

### Request

```ts
{
  protocolVersion: 1,
  deviceId: string,
  cursor: number,
  dataGeneration: number,
  mutations: Array<{
    id: string,
    sequence: number,
    entity: "fast" | "weight" | "preferences" | "data",
    operation: string,
    payload: unknown,
    dataGeneration: number
  }>
}
```

Cap mutation count and body size. Batches should be small enough for free-tier Worker/D1 limits, for example 50 mutations, with the exact cap exported in the shared contract.

### Response

```ts
{
  protocolVersion: 1,
  cursor: number,
  dataGeneration: number,
  acknowledgedMutationIds: string[],
  changes: ServerChange[],
  hasMore: boolean,
  snapshot?: Snapshot
}
```

Use a full snapshot when the cursor is absent/too old or generation changes. Do not return secrets or push subscription details.

## Server algorithm

1. Authenticate and validate request size/schema.
2. Compare data generation.
3. For each mutation in sequence:
   - skip if receipt exists and include it as acknowledged;
   - repeat domain validation;
   - apply using last-arrival-wins;
   - allocate revision;
   - write entity/tombstone, change, and receipt idempotently;
   - update notification jobs through an injected hook/transaction seam added for FAS-014.
4. Pull changes after the request cursor, including changes produced by this batch.
5. Return bounded changes and `hasMore`.

If the database mechanism cannot atomically apply the entire batch, make each mutation independently atomic/idempotent and stop at the first failure. Return acknowledgements only for committed mutations.

## Conflict semantics

- Server acceptance order decides conflicts, not client time.
- A late mutation can overwrite an earlier edit of the same entity.
- Different entity IDs never overwrite one another.
- Deletes are tombstones and may be overwritten only by an explicit restore/upsert mutation.
- Preference updates should be field-aware if feasible so changing theme does not overwrite a separately changed timezone; otherwise define each preference field as its own entity/key.

### Competing active fasts

When a start mutation arrives while another active fast exists:

- the last accepted start becomes active under the agreed policy;
- supersede/tombstone the prior active state in the same recoverable operation;
- emit changes for every affected entity;
- cancel/reschedule associated reminders later through the notification hook.

Ordinary UI still prevents starting two local active fasts.

## Client coordinator

Implement one foreground coordinator per browser profile:

- use `navigator.locks` when available, with `BroadcastChannel` fallback/coordination, to avoid multiple tabs sending the same queue concurrently;
- mark a bounded batch `sending` in Dexie;
- call sync with Bearer auth and `no-store`;
- atomically apply response and acknowledgements;
- loop while `hasMore` or pending mutations remain, with a sensible iteration cap;
- return `sending` mutations to pending after transient failure;
- stop on revoked/expired/generation-reset states.

### Triggers

- app bootstrap after local render;
- successful local mutation;
- `online` event;
- visibility change to visible;
- periodic foreground retry with capped exponential backoff and jitter.

Do not run a second-by-second sync timer. Do not depend on Background Sync.

## Failure behavior

Classify errors:

- offline/network: remain queued, show Offline only when browser reports offline;
- transient 5xx/D1: retry with backoff; show actionable sync error after repeated failures;
- validation: quarantine the bad mutation and show a specific error instead of retrying forever;
- generation mismatch: replace snapshot and discard obsolete-generation mutations;
- revoked: execute FAS-006 erase flow;
- expired: erase local data and show expiration state.

Keep a small local diagnostic code/count, never sensitive payloads.

## Full snapshot

A snapshot includes non-deleted current fasts/weights, current active fast, preferences, cursor, and data generation. Apply it in one Dexie transaction. Preserve only mutations the server explicitly says can be rebased; v1 may discard obsolete-generation mutations after a clear/import reset.

## Test plan

Minimum happy paths:

1. A queued offline fast syncs after the transport succeeds.
2. Retrying the same mutation ID changes server state once.
3. Two records edited on separate devices both survive.
4. Two edits to one record resolve to the last server arrival.
5. A response applies changes and acknowledgements in one local transaction.
6. `hasMore` pulls the next page without resending acknowledged mutations.
7. Generation mismatch installs a snapshot and removes obsolete mutations.
8. A transient failure returns sending rows to pending.

Use in-memory/fake IndexedDB plus local D1 integration for the narrowest useful protocol tests. Keep fixtures explicit.

## Observability

Record only aggregate operational fields: request ID, mutation count, change count, status, duration, and non-sensitive error code. Never log payloads, IDs tied to health records, Authorization, or timestamps from records.

## Acceptance criteria

- Offline writes survive reload and later sync.
- Mutation retries are idempotent.
- Per-record last-arrival-wins matches the specification.
- Multiple tabs do not create duplicate effects.
- Sync success is visually silent; persistent failures become actionable.
- Batches and response pages are bounded.
- No whole-log overwrite occurs during normal sync.

## Out of scope

Feature UI, service-worker background sync, and actual push sending.

## Completion note

Implemented bounded protocol-v1 sync through `POST /api/sync`, per-mutation atomic D1 receipts and changes, idempotent retries, field-aware preference patches, atomic last-arriving active-fast replacement, paged pulls, generation-reset snapshots, and a notification-statement transaction seam for FAS-014. The foreground client coordinator uses Web Locks with BroadcastChannel/local-lease coordination, syncs after bootstrap and local writes, retries on online/visibility/foreground timers with capped backoff, applies responses transactionally, quarantines validation failures, and delegates revoked/expired erasure to identity lifecycle handling.

Validation: focused sync, local database, contract, and D1 integration tests passed (36 tests); the complete Vitest suite passed (74 tests); `npm run typecheck`, `npm run build`, and `git diff --check` passed. The production build emitted `/api/sync`. Successful synchronization remains visually silent; existing shell error presentation is used only after repeated failures. Chrome was unavailable in this child session, so no visual comparison is claimed for that persistent-error state; final browser verification remains part of FAS-016.