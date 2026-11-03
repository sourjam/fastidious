import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ChecklistCompletionRecord,
  ChecklistItemRecord,
  EpochMs,
  FastId,
  GroceryItemId,
  GroceryItemRecord,
  IanaTimezone,
  LogId,
} from "../domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "../local-db/database";
import { saveDailyLogRecord, startFast } from "../local-db/operations";
import { replaceActiveLog } from "../local-db/reset";
import { emptyDailyLogSnapshot, META_KEY, type ServerSnapshot } from "../local-db/schema";
import { runSync, SyncTransportError } from "./client";
import { MAX_SYNC_BODY_BYTES, type SyncResponse } from "./contract";

const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const FAST_ID = "20000000-0000-4000-8000-000000000001" as FastId;
const NOW = 100_000 as EpochMs;

function snapshot(overrides: Partial<ServerSnapshot> = {}): ServerSnapshot {
  return {
    logId: LOG_ID,
    cursor: 0,
    serverGeneration: 1,
    dataGeneration: 1,
    credentialGeneration: 1,
    fasts: [],
    weights: [],
    ...emptyDailyLogSnapshot(),
    preferences: {
      timezone: "UTC" as IanaTimezone,
      theme: "system",
      weightUnit: "kg",
      defaultGoalHours: 16,
    },
    ...overrides,
  };
}

function response(overrides: Partial<SyncResponse> = {}): SyncResponse {
  return {
    protocolVersion: 1,
    cursor: 1,
    serverGeneration: 1,
    dataGeneration: 1,
    credentialGeneration: 1,
    acknowledgedMutationIds: [],
    changes: [],
    hasMore: false,
    ...overrides,
  };
}

describe("sync client", () => {
  let db: FastidiousDatabase;

  beforeEach(async () => {
    db = await openLocalDatabase(`sync-${crypto.randomUUID()}`);
    await replaceActiveLog(db, snapshot(), NOW);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("sends an offline-created fast and removes its acknowledged mutation", async () => {
    const created = await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    if (!created.ok) throw new Error(created.message);
    const serverRecord = { ...created.value.value, revision: 1, updatedAt: NOW };

    const result = await runSync(db, "secret", {
      send: async (_secret, request) => response({
        acknowledgedMutationIds: [request.mutations[0]!.id],
        changes: [{ revision: 1, entityType: "fast", entityId: FAST_ID, record: serverRecord }],
      }),
    });

    expect(result.status).toBe("synced");
    expect(await db.mutations.count()).toBe(0);
    expect(await db.fasts.get(FAST_ID)).toMatchObject({ revision: 1 });
  });

  it("syncs an offline checklist completion after reconnection", async () => {
    const item: ChecklistItemRecord = {
      id: "60000000-0000-4000-8000-000000000101" as never,
      logId: LOG_ID,
      name: "Take vitamins",
      cadence: "daily",
      externalUrl: null,
      imageAssetId: null,
      sortOrder: 0,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    };
    const completion: ChecklistCompletionRecord = {
      id: "60000000-0000-4000-8000-000000000102" as never,
      logId: LOG_ID,
      checklistItemId: item.id,
      periodKey: "day:1970-01-01" as never,
      completedAt: 2_000 as EpochMs,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    };
    await saveDailyLogRecord(db, "checklistItem", item, NOW);
    await saveDailyLogRecord(db, "checklistCompletion", completion, NOW);

    const offline = await runSync(db, "secret", {
      send: async () => { throw new SyncTransportError("offline", "offline"); },
    });
    expect(offline.status).toBe("offline");
    expect(await db.mutations.where("status").equals("pending").count()).toBe(2);

    const synced = await runSync(db, "secret", {
      send: async (_secret, request) => response({
        cursor: 2,
        acknowledgedMutationIds: request.mutations.map((mutation) => mutation.id),
        changes: [
          { revision: 1, entityType: "checklistItem", entityId: item.id, record: { ...item, revision: 1 } },
          { revision: 2, entityType: "checklistCompletion", entityId: completion.id, record: { ...completion, revision: 2 } },
        ],
      }),
    });

    expect(synced.status).toBe("synced");
    expect(await db.mutations.count()).toBe(0);
    expect(await db.checklistCompletions.get(completion.id)).toMatchObject({ revision: 2 });
  });

  it("syncs an offline grocery cart toggle after reconnection", async () => {
    const grocery: GroceryItemRecord = {
      id: "60000000-0000-4000-8000-000000000601" as GroceryItemId,
      logId: LOG_ID,
      foodId: null,
      name: "Oranges",
      inCart: true,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    };
    await saveDailyLogRecord(db, "groceryItem", grocery, NOW);
    expect((await runSync(db, "secret", {
      send: async () => { throw new SyncTransportError("offline", "offline"); },
    })).status).toBe("offline");

    const synced = await runSync(db, "secret", {
      send: async (_secret, request) => response({
        acknowledgedMutationIds: request.mutations.map((mutation) => mutation.id),
        changes: [{ revision: 1, entityType: "groceryItem", entityId: grocery.id, record: { ...grocery, revision: 1 } }],
      }),
    });

    expect(synced.status).toBe("synced");
    expect(await db.groceryItems.get(grocery.id)).toMatchObject({ inCart: true, revision: 1 });
  });

  it("rolls back acknowledgements when applying a response change fails", async () => {
    const created = await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    if (!created.ok) throw new Error(created.message);

    const result = await runSync(db, "secret", {
      send: async () => response({
        acknowledgedMutationIds: [created.value.mutation.mutationId],
        changes: [{
          revision: 1,
          entityType: "fast",
          entityId: FAST_ID,
          record: { ...created.value.value, startAt: -1 as EpochMs, revision: 1 },
        }],
      }),
    });

    expect(result.status).toBe("error");
    expect((await db.mutations.get(created.value.mutation.mutationId))?.status).toBe("pending");
  });

  it("returns sending mutations to pending after a transient failure", async () => {
    await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });

    const result = await runSync(db, "secret", {
      send: async () => { throw new SyncTransportError("transient", "retry later"); },
    });

    expect(result.status).toBe("error");
    expect((await db.mutations.toArray())[0]?.status).toBe("pending");
    expect((await db.meta.get(META_KEY))?.syncError).toBe("transient");
  });

  it("installs a generation-reset snapshot and discards obsolete mutations", async () => {
    await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    const reset = snapshot({ cursor: 4, dataGeneration: 2, fasts: [] });

    await runSync(db, "secret", {
      send: async () => response({ cursor: 4, dataGeneration: 2, snapshot: reset }),
    });

    expect(await db.mutations.count()).toBe(0);
    expect(await db.fasts.count()).toBe(0);
    expect((await db.meta.get(META_KEY))?.dataGeneration).toBe(2);
  });

  it("splits oversized mutation queues without changing sequence order", async () => {
    const meta = await db.meta.get(META_KEY);
    if (!meta) throw new Error("Missing metadata");
    await db.mutations.bulkAdd(Array.from({ length: 30 }, (_, index) => ({
      mutationId: crypto.randomUUID() as never,
      deviceId: meta.deviceId,
      sequence: index + 1,
      status: "pending" as const,
      entityType: "food" as const,
      entityId: `food-${index}`,
      operation: "upsert",
      payload: { index, padding: "x".repeat(20_000) },
      dataGeneration: 1,
      createdAt: NOW,
    })));
    const seenSequences: number[] = [];
    const bodySizes: number[] = [];

    const result = await runSync(db, "secret", {
      send: async (_secret, request) => {
        seenSequences.push(...request.mutations.map((mutation) => mutation.sequence));
        bodySizes.push(new TextEncoder().encode(JSON.stringify(request)).byteLength);
        return response({
          cursor: seenSequences.length,
          acknowledgedMutationIds: request.mutations.map((mutation) => mutation.id),
        });
      },
    });

    expect(result.status).toBe("synced");
    expect(seenSequences).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(bodySizes.every((size) => size <= MAX_SYNC_BODY_BYTES)).toBe(true);
  });

  it("pulls another page without resending an acknowledged mutation", async () => {
    const created = await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    if (!created.ok) throw new Error(created.message);
    const mutationId = created.value.mutation.mutationId;
    const sentCounts: number[] = [];

    await runSync(db, "secret", {
      send: async (_secret, request) => {
        sentCounts.push(request.mutations.length);
        return response({
          cursor: sentCounts.length,
          acknowledgedMutationIds: sentCounts.length === 1 ? [mutationId] : [],
          hasMore: sentCounts.length === 1,
        });
      },
    });

    expect(sentCounts).toEqual([1, 0]);
  });
});
