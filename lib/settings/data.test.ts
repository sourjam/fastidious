import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EpochMs, FastId, IanaTimezone, LogId, WeightId } from "../domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "../local-db/database";
import { clearData, replaceFromImport } from "../local-db/operations";
import { replaceActiveLog } from "../local-db/reset";
import { emptyDailyLogSnapshot, type ServerSnapshot } from "../local-db/schema";
import { buildExport, MAX_IMPORT_BYTES, MAX_IMPORT_RECORDS, parseImport } from "./data";

const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const FAST_ID = "20000000-0000-4000-8000-000000000001" as FastId;
const WEIGHT_ID = "30000000-0000-4000-8000-000000000001" as WeightId;
const NOW = 1_700_000_000_000 as EpochMs;
const preferences = {
  timezone: "America/New_York" as IanaTimezone,
  theme: "system" as const,
  weightUnit: "lb" as const,
  defaultGoalHours: 16,
};

function snapshot(): ServerSnapshot {
  return {
    logId: LOG_ID,
    cursor: 9,
    serverGeneration: 1,
    dataGeneration: 1,
    credentialGeneration: 4,
    preferences,
    ...emptyDailyLogSnapshot(),
    fasts: [{
      id: FAST_ID,
      logId: LOG_ID,
      startAt: (NOW - 10_000) as EpochMs,
      endAt: null,
      goalHours: 16,
      revision: 8,
      updatedAt: (NOW - 10_000) as EpochMs,
      deletedAt: null,
    }],
    weights: [{
      id: WEIGHT_ID,
      logId: LOG_ID,
      measuredAt: (NOW - 5_000) as EpochMs,
      kilograms: 70,
      revision: 9,
      updatedAt: (NOW - 5_000) as EpochMs,
      deletedAt: null,
    }],
  };
}

describe("settings data", () => {
  let db: FastidiousDatabase;

  beforeEach(async () => {
    db = await openLocalDatabase(`settings-${crypto.randomUUID()}`);
    await replaceActiveLog(db, snapshot(), NOW);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("exports local domain data without identity, device, or sync fields", async () => {
    const exported = await buildExport(db, new Date(NOW));
    const json = JSON.stringify(exported);

    expect(exported).toMatchObject({ app: "fastidious", version: 2, preferences, fasts: [{ id: FAST_ID }], weights: [{ id: WEIGHT_ID }] });
    expect(json).not.toMatch(/secret|logId|deviceId|cursor|generation|mutation|revision|updatedAt|deletedAt/i);
  });

  it("imports a v1 export with empty v2 collections and targets", () => {
    const parsed = parseImport(JSON.stringify({
      app: "fastidious",
      version: 1,
      exportedAt: new Date(NOW).toISOString(),
      preferences,
      fasts: [],
      weights: [],
    }), LOG_ID, NOW);

    expect(parsed).toMatchObject({
      ok: true,
      value: {
        mealCount: 0,
        foodCount: 0,
        activityCount: 0,
        exerciseCount: 0,
        checklistItemCount: 0,
        checklistCompletionCount: 0,
        groceryItemCount: 0,
        snapshot: {
          categories: [],
          nutritionTargets: { calories: null, proteinGrams: null, fiberGrams: null },
        },
      },
    });
  });

  it("imports meal records from earlier v2 exports without an image field", async () => {
    await db.meals.put({
      id: "60000000-0000-4000-8000-000000000008" as never,
      logId: LOG_ID,
      eatenAt: (NOW - 1_000) as EpochMs,
      items: [{ foodId: null, name: "Soup", quantity: 1, caloriesPerServing: 250, proteinGramsPerServing: null, fiberGramsPerServing: null }],
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });
    const exported = await buildExport(db, new Date(NOW));
    delete (exported.meals[0] as { imageAssetId?: unknown }).imageAssetId;

    expect(parseImport(JSON.stringify(exported), LOG_ID, NOW)).toMatchObject({
      ok: true,
      value: { snapshot: { meals: [{ imageAssetId: null }] } },
    });
  });

  it("rejects malformed import without changing local state", async () => {
    const before = await buildExport(db, new Date(NOW));
    const parsed = parseImport('{"app":"fastidious","version":1,"fasts":[]}', LOG_ID, NOW);

    expect(parsed.ok).toBe(false);
    expect(await buildExport(db, new Date(NOW))).toEqual(before);
  });

  it("rejects an oversized import before changing local data", async () => {
    const before = await buildExport(db, new Date(NOW));
    const parsed = parseImport("x".repeat(MAX_IMPORT_BYTES + 1), LOG_ID, NOW);
    expect(parsed).toMatchObject({ ok: false, code: "import_too_large" });
    expect(await buildExport(db, new Date(NOW))).toEqual(before);
  });

  it("rejects imports with an excessive record count before validating records", () => {
    const parsed = parseImport(JSON.stringify({
      app: "fastidious",
      version: 1,
      exportedAt: new Date(NOW).toISOString(),
      preferences,
      fasts: Array.from({ length: MAX_IMPORT_RECORDS + 1 }, () => null),
      weights: [],
    }), LOG_ID, NOW);
    expect(parsed).toMatchObject({ ok: false, code: "too_many_records" });
  });

  it("exports and previews every v2 collection without sync metadata", async () => {
    const metadata = { logId: LOG_ID, revision: 0, updatedAt: NOW, deletedAt: null };
    const categoryId = "60000000-0000-4000-8000-000000000001" as never;
    const foodId = "60000000-0000-4000-8000-000000000002" as never;
    const activityId = "60000000-0000-4000-8000-000000000003" as never;
    const checklistItemId = "60000000-0000-4000-8000-000000000004" as never;
    await db.categories.put({ ...metadata, id: categoryId, kind: "food", name: "Other", sortOrder: 0 });
    await db.foods.put({
      ...metadata,
      id: foodId,
      name: "Beans",
      serving: "1 can",
      categoryId,
      calories: 395,
      proteinGrams: 17,
      fiberGrams: 10,
      priceCents: 199,
      externalUrl: null,
      imageAssetId: "asset_1234567890123456" as never,
    });
    await db.meals.put({
      ...metadata,
      id: "60000000-0000-4000-8000-000000000005" as never,
      eatenAt: (NOW - 1_000) as EpochMs,
      items: [{ foodId, name: "Beans", quantity: 1, caloriesPerServing: 395, proteinGramsPerServing: 17, fiberGramsPerServing: 10 }],
      imageAssetId: "asset_1234567890123459" as never,
    });
    await db.activities.put({
      ...metadata,
      id: activityId,
      name: "Dips",
      detail: "3 sets",
      categoryId: null,
      externalUrl: null,
      imageAssetId: null,
    });
    await db.exercise.put({
      ...metadata,
      id: "60000000-0000-4000-8000-000000000006" as never,
      activityId,
      text: "Dips 10, 12, 15",
      performedAt: (NOW - 900) as EpochMs,
    });
    await db.checklistItems.put({
      ...metadata,
      id: checklistItemId,
      name: "Vitamins",
      cadence: "daily",
      externalUrl: null,
      imageAssetId: null,
      sortOrder: 0,
    });
    await db.checklistCompletions.put({
      ...metadata,
      id: "60000000-0000-4000-8000-000000000007" as never,
      checklistItemId,
      periodKey: "day:2023-11-14" as never,
      completedAt: (NOW - 800) as EpochMs,
    });
    await db.groceryItems.put({
      ...metadata,
      id: "60000000-0000-4000-8000-000000000008" as never,
      foodId,
      name: "Beans",
      inCart: false,
      externalUrl: null,
      imageAssetId: null,
    });
    await db.nutritionTargets.put({ key: "active", calories: 2_000, proteinGrams: null, fiberGrams: 30 });

    const exported = await buildExport(db, new Date(NOW));
    const json = JSON.stringify(exported);
    const parsed = parseImport(json, LOG_ID, NOW);

    expect(json).not.toMatch(/logId|revision|updatedAt|deletedAt/);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        mealCount: 1,
        foodCount: 1,
        activityCount: 1,
        exerciseCount: 1,
        checklistItemCount: 1,
        checklistCompletionCount: 1,
        groceryItemCount: 1,
        droppedImageCount: 2,
        snapshot: { foods: [{ imageAssetId: null }], meals: [{ imageAssetId: null }], nutritionTargets: { calories: 2_000, proteinGrams: null, fiberGrams: 30 } },
      },
    });
    if (!parsed.ok) throw new Error(parsed.message);
    await Promise.all([
      db.categories.clear(), db.foods.clear(), db.meals.clear(), db.activities.clear(), db.exercise.clear(),
      db.checklistItems.clear(), db.checklistCompletions.clear(), db.groceryItems.clear(), db.nutritionTargets.clear(),
    ]);

    const replaced = await replaceFromImport(db, { snapshot: parsed.value.snapshot, now: NOW });

    expect(replaced.ok).toBe(true);
    expect(await Promise.all([
      db.categories.count(), db.foods.count(), db.meals.count(), db.activities.count(), db.exercise.count(),
      db.checklistItems.count(), db.checklistCompletions.count(), db.groceryItems.count(), db.nutritionTargets.count(),
    ])).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect((await db.meta.get("state"))?.dataGeneration).toBe(2);
  });

  it("clear retains identity and preferences while removing domain data", async () => {
    await db.meals.put({
      id: "60000000-0000-4000-8000-000000000009" as never,
      logId: LOG_ID,
      eatenAt: (NOW - 1_000) as EpochMs,
      items: [{ foodId: null, name: "Soup", quantity: 1, caloriesPerServing: 250, proteinGramsPerServing: null, fiberGramsPerServing: null }],
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });
    await db.nutritionTargets.put({ key: "active", calories: 2_000, proteinGrams: null, fiberGrams: null });

    const result = await clearData(db, { now: NOW });

    expect(result.ok).toBe(true);
    expect(await db.fasts.count()).toBe(0);
    expect(await db.weights.count()).toBe(0);
    expect(await db.meals.count()).toBe(0);
    expect(await db.nutritionTargets.count()).toBe(0);
    expect(await db.preferences.get("active")).toMatchObject(preferences);
    expect(await db.meta.get("state")).toMatchObject({ logId: LOG_ID, credentialGeneration: 4, dataGeneration: 2 });
    expect(await db.mutations.toArray()).toMatchObject([{ operation: "clear", dataGeneration: 2 }]);
  });

  it("previews valid data and replacement queues one generation reset", async () => {
    const exported = await buildExport(db, new Date(NOW));
    const parsed = parseImport(JSON.stringify(exported), LOG_ID, NOW);
    if (!parsed.ok) throw new Error(parsed.message);

    const result = await replaceFromImport(db, { snapshot: parsed.value.snapshot, now: NOW });

    expect(parsed.value).toMatchObject({ fastCount: 1, weightCount: 1, timezone: "America/New_York", hasActiveFast: true });
    expect(result.ok).toBe(true);
    expect(await db.mutations.toArray()).toMatchObject([{ entityType: "log", operation: "replace", dataGeneration: 2 }]);
    expect((await db.meta.get("state"))?.dataGeneration).toBe(2);
  });
});
