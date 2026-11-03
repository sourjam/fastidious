# FAS-018 — V2 persistence, synchronization, and data portability

**Status:** Closed

## Objective

Persist and synchronize all v2 daily-log entities defined by FAS-017 using the existing local-first Dexie, mutation, D1, and cursor-based sync architecture.

## Dependencies

FAS-004, FAS-005, FAS-007, FAS-011, and FAS-017.

## Scope

Add local and server storage for:

- food and activity categories;
- foods and reusable activities;
- meals and exercise entries;
- checklist items and completions;
- grocery items;
- nutrition targets;
- nullable image asset references reserved for FAS-024.

All user-visible writes must update IndexedDB and enqueue a mutation in one transaction before reporting success.

## Local database

- Add a sequential Dexie schema version without rebuilding existing fast/weight records.
- Use queryable timestamps for meals, exercise, and checklist completions.
- Keep categories ordered explicitly rather than deriving order from insertion accidents.
- Keep pending image blobs and upload state out of this migration; FAS-024 adds them last.
- Include every new entity in generation-reset clear/import transactions.

## D1

Add checked-in sequential migrations and prepared repositories. Prefer explicit tables for independently mutable records rather than one JSON blob.

Every synchronized row needs:

- log ID and entity ID;
- revision;
- updated timestamp for diagnostics only;
- deletion tombstone where the entity can be deleted.

Checklist completion identity must make one completion per item/period enforceable transactionally. Category deletion/reassignment and data replacement must be atomic.

## Sync

- Extend mutation and change entity unions explicitly.
- Validate unknown payloads before repository calls.
- Preserve idempotent mutation receipts.
- Use server arrival order for conflicts; device clocks never decide.
- Treat unrelated records independently.
- Return full v2 snapshots on cursor expiry/generation mismatch.
- Bound batch count and body size; split large queues without reordering dependent mutations.
- Do not put image bytes in sync payloads. Only opaque Cloudflare Images references may sync after FAS-024.

## Clear and replacement import

Version the export schema forward and include all v2 records and targets. Continue excluding secrets, device IDs, cursors, mutations, receipts, and push data.

- Validate the complete import before mutation.
- Preview counts for fasts, weights, meals, foods, activities, exercise entries, checklist items/completions, and grocery items.
- Replace all synchronized data in one generation-reset flow.
- Preserve log identity, credential, and documented settings.
- Extend the local pre-import backup to all new entities.
- Existing v1 exports remain importable with empty v2 collections.
- Image portability is finalized by FAS-024; until then only nullable asset metadata is accepted.

## Cleanup and expiration

Extend clear-all, log expiration, and server cleanup to every new table. No orphaned daily-log records may survive log deletion.

## Test plan

Minimum integration tests:

1. One local meal write stores its items and queued mutation atomically.
2. One offline checklist completion syncs after reconnection.
3. Replaying a food mutation is idempotent.
4. Category deletion and reassignment are atomic.
5. A generation mismatch replaces every v2 collection and drops stale queued mutations.
6. A v1 export imports with empty v2 data.
7. A v2 replacement import changes generation and restores all new entities.
8. Expiration deletes all v2 rows.
9. Oversized sync queues split without changing mutation order.

## Acceptance criteria

- Every v2 user action has a durable local-first mutation path.
- New entities synchronize across devices and participate in snapshots/deltas.
- Clear, replacement import, expiration, and secret-revocation cleanup cover all v2 data.
- Sync payloads never contain image bytes.
- Existing v1 data and exports remain valid.
- D1 queries are prepared, indexed, bounded, and free-tier conscious.

## Out of scope

Feature UI and Cloudflare Images upload/delivery.

## Completion note

Added a sequential Dexie v2 schema and D1 migration for all daily-log entities and targets; atomic local writes and category reassignment; validated, idempotent delta/snapshot synchronization; body-size queue splitting; complete generation resets, backups, clear, expiration cascade, and v1/v2 import/export handling. Sync continues to carry only nullable opaque image references—never image bytes. Validated with 154 passing Vitest tests, `npm run typecheck`, `npm run build`, and `git diff --check`. Focused integration coverage includes meal write rollback, offline checklist reconnection, food replay idempotency, category reassignment, v2 replacement/clear, v1 imports, all v2 export collections, database upgrade preservation, expiration cleanup, and ordered oversized queue splitting.
