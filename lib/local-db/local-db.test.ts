import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ActivityId,
  ChecklistItemId,
  EpochMs,
  FastId,
  FoodId,
  GroceryItemId,
  IanaTimezone,
  LogId,
  MealId,
  MealRecord,
} from "../domain/types";
import { applyServerState, markMutationsSending } from "./apply-server-state";
import { openLocalDatabase, type FastidiousDatabase } from "./database";
import {
  deleteCategoryAndReassign,
  deleteDailyLogRecord,
  deleteFast,
  endFast,
  restoreFast,
  resumeFast,
  saveDailyLogRecord,
  saveExerciseEntry,
  saveRecordWithPendingImage,
  attachUploadedImage,
  startFast,
  toggleChecklistItemCompletion,
} from "./operations";
import { replaceActiveLog } from "./reset";
import { emptyDailyLogSnapshot, type ServerSnapshot } from "./schema";

const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const FAST_ID = "20000000-0000-4000-8000-000000000001" as FastId;
const OTHER_FAST_ID = "20000000-0000-4000-8000-000000000002" as FastId;
const NOW = 100_000 as EpochMs;

const preferences = {
  timezone: "America/New_York" as IanaTimezone,
  theme: "system" as const,
  weightUnit: "lb" as const,
  defaultGoalHours: 16,
};

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
    preferences,
    ...overrides,
  };
}

function fast(id = FAST_ID, revision = 1) {
  return {
    id,
    logId: LOG_ID,
    startAt: 1_000 as EpochMs,
    endAt: 2_000 as EpochMs,
    goalHours: 16,
    revision,
    updatedAt: 2_000 as EpochMs,
    deletedAt: null,
  };
}

describe("local database", () => {
  let db: FastidiousDatabase;
  let name: string;

  beforeEach(async () => {
    name = `fastidious-test-${crypto.randomUUID()}`;
    db = await openLocalDatabase(name);
    await replaceActiveLog(db, snapshot(), NOW);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("upgrades a version-one database without rebuilding existing fasts", async () => {
    db.close();
    await db.delete();
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      meta: "&key, logId, deviceId",
      fasts: "&id, logId, startAt, endAt, revision, deletedAt",
      weights: "&id, logId, measuredAt, revision, deletedAt",
      preferences: "&key",
      mutations: "&mutationId, &sequence, status, [status+sequence], [entityType+entityId], dataGeneration",
      preImportBackup: "&key",
    });
    await legacy.open();
    await legacy.table("fasts").put(fast());
    await legacy.table("preImportBackup").put({
      key: "pre-import",
      createdAt: NOW,
      dataGeneration: 1,
      fasts: [fast()],
      weights: [],
      preferences,
    });
    legacy.close();

    db = await openLocalDatabase(name);

    expect(db.verno).toBe(3);
    expect(await db.fasts.get(FAST_ID)).toEqual(fast());
    expect(await db.meals.count()).toBe(0);
    expect(await db.preImportBackup.get("pre-import")).toMatchObject({
      categories: [],
      meals: [],
      nutritionTargets: { calories: null, proteinGrams: null, fiberGrams: null },
    });
  });

  it("writes a meal and its queued mutation in one transaction", async () => {
    const meal: MealRecord = {
      id: "60000000-0000-4000-8000-000000000001" as MealId,
      logId: LOG_ID,
      eatenAt: 2_000 as EpochMs,
      items: [{
        foodId: null,
        name: "Soup",
        quantity: 1,
        caloriesPerServing: 250,
        proteinGramsPerServing: 8,
        fiberGramsPerServing: 4,
      }],
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    };

    const result = await saveDailyLogRecord(db, "meal", meal, NOW);

    expect(result.ok).toBe(true);
    expect(await db.meals.get(meal.id)).toEqual(meal);
    expect(await db.mutations.toArray()).toMatchObject([{
      entityType: "meal",
      entityId: meal.id,
      operation: "upsert",
      payload: meal,
      sequence: 1,
    }]);
  });

  it("rolls back a meal when queuing its mutation fails", async () => {
    const meal: MealRecord = {
      id: "60000000-0000-4000-8000-000000000002" as MealId,
      logId: LOG_ID,
      eatenAt: 2_000 as EpochMs,
      items: [{ foodId: null, name: "Soup", quantity: 1, caloriesPerServing: 250, proteinGramsPerServing: null, fiberGramsPerServing: null }],
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    };
    const add = db.mutations.add.bind(db.mutations);
    db.mutations.add = (() => { throw new Error("mutation write failed"); }) as typeof db.mutations.add;

    await expect(saveDailyLogRecord(db, "meal", meal, NOW)).rejects.toThrow("mutation write failed");
    expect(await db.meals.count()).toBe(0);
    db.mutations.add = add;
  });

  it("toggles a weekly checklist completion atomically for one product week", async () => {
    const itemId = "60000000-0000-4000-8000-000000000301" as ChecklistItemId;
    await db.checklistItems.put({
      id: itemId,
      logId: LOG_ID,
      name: "Weekly weigh-in",
      cadence: "weekly",
      externalUrl: null,
      imageAssetId: null,
      sortOrder: 0,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });
    const monday = Date.parse("2026-11-02T17:00:00Z") as EpochMs;
    const friday = Date.parse("2026-11-06T17:00:00Z") as EpochMs;

    const completed = await toggleChecklistItemCompletion(db, {
      itemId,
      at: monday,
      timezone: "America/New_York" as IanaTimezone,
      now: monday,
    });

    expect(completed.ok).toBe(true);
    expect(await db.checklistCompletions.where("checklistItemId").equals(itemId).toArray()).toHaveLength(1);
    expect(await db.mutations.toArray()).toMatchObject([{ entityType: "checklistCompletion", operation: "upsert" }]);

    const removed = await toggleChecklistItemCompletion(db, {
      itemId,
      at: friday,
      timezone: "America/New_York" as IanaTimezone,
      now: friday,
    });

    expect(removed.ok).toBe(true);
    expect((await db.checklistCompletions.toArray()).filter((entry) => entry.deletedAt === null)).toHaveLength(0);
    expect((await db.mutations.orderBy("sequence").toArray()).map((mutation) => mutation.operation)).toEqual(["upsert", "delete"]);
  });

  it("saves a free-text exercise and reusable activity in one local transaction", async () => {
    const activityId = "60000000-0000-4000-8000-000000000401" as ActivityId;
    const exerciseId = "60000000-0000-4000-8000-000000000402" as never;
    const result = await saveExerciseEntry(db, {
      activity: {
        id: activityId,
        logId: LOG_ID,
        name: "Dips 10, 12, 15",
        detail: "",
        categoryId: null,
        externalUrl: null,
        imageAssetId: null,
        revision: 0,
        updatedAt: NOW,
        deletedAt: null,
      },
      exercise: {
        id: exerciseId,
        logId: LOG_ID,
        activityId,
        text: "Dips 10, 12, 15",
        performedAt: NOW,
        revision: 0,
        updatedAt: NOW,
        deletedAt: null,
      },
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(await db.activities.get(activityId)).toBeDefined();
    expect(await db.exercise.get(exerciseId)).toBeDefined();
    expect((await db.mutations.orderBy("sequence").toArray()).map((mutation) => mutation.entityType)).toEqual(["activity", "exercise"]);
  });

  it("deletes an activity while preserving historical exercise text", async () => {
    const activityId = "60000000-0000-4000-8000-000000000411" as ActivityId;
    const exerciseId = "60000000-0000-4000-8000-000000000412" as never;
    await db.activities.put({
      id: activityId,
      logId: LOG_ID,
      name: "Dips",
      detail: "10, 12, 15",
      categoryId: null,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });
    await db.exercise.put({
      id: exerciseId,
      logId: LOG_ID,
      activityId,
      text: "Dips 10, 12, 15",
      performedAt: NOW,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });

    await deleteDailyLogRecord(db, "activity", activityId, NOW);

    expect(await db.exercise.get(exerciseId)).toMatchObject({ activityId: null, text: "Dips 10, 12, 15" });
  });

  it("deletes a food without changing its historical meal snapshot", async () => {
    const foodId = "60000000-0000-4000-8000-000000000311" as never;
    const mealId = "60000000-0000-4000-8000-000000000312" as MealId;
    await db.foods.put({
      id: foodId,
      logId: LOG_ID,
      name: "Beans",
      serving: "1 can",
      categoryId: null,
      calories: 395,
      proteinGrams: 17,
      fiberGrams: 10,
      priceCents: null,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });
    await db.meals.put({
      id: mealId,
      logId: LOG_ID,
      eatenAt: NOW,
      items: [{ foodId, name: "Beans", quantity: 1, caloriesPerServing: 395, proteinGramsPerServing: 17, fiberGramsPerServing: 10 }],
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });

    await deleteDailyLogRecord(db, "food", foodId, NOW);

    expect(await db.meals.get(mealId)).toMatchObject({
      items: [{ name: "Beans", caloriesPerServing: 395, proteinGramsPerServing: 17, fiberGramsPerServing: 10 }],
    });
  });

  it("deletes a food category and moves its foods to Other atomically", async () => {
    const categoryId = "60000000-0000-4000-8000-000000000321" as never;
    const otherCategoryId = "60000000-0000-4000-8000-000000000322" as never;
    const foodId = "60000000-0000-4000-8000-000000000323" as never;
    await db.categories.bulkPut([
      { id: categoryId, logId: LOG_ID, kind: "food", name: "Pantry", sortOrder: 0, revision: 0, updatedAt: NOW, deletedAt: null },
      { id: otherCategoryId, logId: LOG_ID, kind: "food", name: "Other", sortOrder: 1, revision: 0, updatedAt: NOW, deletedAt: null },
    ]);
    await db.foods.put({
      id: foodId,
      logId: LOG_ID,
      name: "Beans",
      serving: "1 can",
      categoryId,
      calories: 395,
      proteinGrams: 17,
      fiberGrams: 10,
      priceCents: null,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });

    const result = await deleteCategoryAndReassign(db, { categoryId, replacementCategoryId: otherCategoryId, now: NOW });

    expect(result.ok).toBe(true);
    expect(await db.foods.get(foodId)).toMatchObject({ categoryId: otherCategoryId });
    expect(await db.categories.get(categoryId)).toMatchObject({ deletedAt: NOW });
    expect(await db.mutations.toArray()).toMatchObject([{ entityType: "category", operation: "delete" }]);
  });

  it("stages and attaches one image for a whole meal", async () => {
    const mealId = "60000000-0000-4000-8000-000000000620" as MealId;
    const meal: MealRecord = {
      id: mealId,
      logId: LOG_ID,
      eatenAt: 2_000 as EpochMs,
      items: [{ foodId: null, name: "Soup", quantity: 1, caloriesPerServing: 250, proteinGramsPerServing: null, fiberGramsPerServing: null }],
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    };
    const staged = await saveRecordWithPendingImage(db, "meal", meal, { blob: new Blob(["image"], { type: "image/webp" }), mimeType: "image/webp", width: 40, height: 40 }, NOW);
    if (!staged.ok) throw new Error(staged.message);

    const attached = await attachUploadedImage(db, staged.value.pending.id, "asset_1234567890123457", NOW);

    expect(attached).toMatchObject({ ok: true, value: { value: { id: mealId, imageAssetId: "asset_1234567890123457" } } });
    expect(await db.pendingImages.count()).toBe(0);
  });

  it("stages an image with its record mutation and attaches it atomically after upload", async () => {
    const foodId = "60000000-0000-4000-8000-000000000621" as FoodId;
    const record = { id: foodId, logId: LOG_ID, name: "Oranges", serving: "1 bag", categoryId: null, calories: 0, proteinGrams: null, fiberGrams: null, priceCents: null, externalUrl: null, imageAssetId: null, revision: 0, updatedAt: NOW, deletedAt: null };
    const staged = await saveRecordWithPendingImage(db, "food", record, { blob: new Blob(["image"], { type: "image/webp" }), mimeType: "image/webp", width: 40, height: 40 }, NOW);
    if (!staged.ok) throw new Error(staged.message);

    db.close();
    db = await openLocalDatabase(name);
    expect(await db.pendingImages.get(staged.value.pending.id)).toMatchObject({ entityId: foodId, status: "pending" });
    expect(await db.mutations.count()).toBe(1);
    const attached = await attachUploadedImage(db, staged.value.pending.id, "asset_1234567890123456", NOW);

    expect(attached.ok).toBe(true);
    expect(await db.pendingImages.count()).toBe(0);
    expect(await db.foods.get(foodId)).toMatchObject({ imageAssetId: "asset_1234567890123456" });
    expect(await db.mutations.count()).toBe(2);
  });

  it("rejects oversized image dimensions before changing the record", async () => {
    const record = { id: "60000000-0000-4000-8000-000000000622" as FoodId, logId: LOG_ID, name: "Oranges", serving: "1 bag", categoryId: null, calories: 0, proteinGrams: null, fiberGrams: null, priceCents: null, externalUrl: null, imageAssetId: null, revision: 0, updatedAt: NOW, deletedAt: null };
    const result = await saveRecordWithPendingImage(db, "food", record, { blob: new Blob(["image"], { type: "image/webp" }), mimeType: "image/webp", width: 5_000, height: 5_000 }, NOW);

    expect(result).toMatchObject({ ok: false, code: "invalid_image_dimensions" });
    expect(await db.foods.get(record.id)).toBeUndefined();
    expect(await db.pendingImages.count()).toBe(0);
  });

  it("preserves a grocery item and clears its link when its food is deleted", async () => {
    const foodId = "60000000-0000-4000-8000-000000000611" as FoodId;
    const groceryId = "60000000-0000-4000-8000-000000000612" as GroceryItemId;
    await db.foods.put({ id: foodId, logId: LOG_ID, name: "Oranges", serving: "1 bag", categoryId: null, calories: 0, proteinGrams: null, fiberGrams: null, priceCents: 399, externalUrl: null, imageAssetId: null, revision: 0, updatedAt: NOW, deletedAt: null });
    await db.groceryItems.put({ id: groceryId, logId: LOG_ID, foodId, name: "Oranges", inCart: false, externalUrl: null, imageAssetId: null, revision: 0, updatedAt: NOW, deletedAt: null });

    await deleteDailyLogRecord(db, "food", foodId, NOW);

    expect(await db.groceryItems.get(groceryId)).toMatchObject({ foodId: null, deletedAt: null, name: "Oranges" });
  });

  it("deletes an activity category and moves its activities to Other", async () => {
    const categoryId = "60000000-0000-4000-8000-000000000421" as never;
    const otherCategoryId = "60000000-0000-4000-8000-000000000422" as never;
    const activityId = "60000000-0000-4000-8000-000000000423" as ActivityId;
    await db.categories.bulkPut([
      { id: categoryId, logId: LOG_ID, kind: "activity", name: "Strength", sortOrder: 0, revision: 0, updatedAt: NOW, deletedAt: null },
      { id: otherCategoryId, logId: LOG_ID, kind: "activity", name: "Other", sortOrder: 1, revision: 0, updatedAt: NOW, deletedAt: null },
    ]);
    await db.activities.put({ id: activityId, logId: LOG_ID, name: "Dips", detail: "", categoryId, externalUrl: null, imageAssetId: null, revision: 0, updatedAt: NOW, deletedAt: null });

    await deleteCategoryAndReassign(db, { categoryId, replacementCategoryId: otherCategoryId, now: NOW });

    expect(await db.activities.get(activityId)).toMatchObject({ categoryId: otherCategoryId });
  });

  it("does not create a second monthly completion in the same month", async () => {
    const itemId = "60000000-0000-4000-8000-000000000302" as ChecklistItemId;
    await db.checklistItems.put({
      id: itemId,
      logId: LOG_ID,
      name: "Refill medication",
      cadence: "monthly",
      externalUrl: null,
      imageAssetId: null,
      sortOrder: 0,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    });
    const firstDay = Date.parse("2026-11-02T17:00:00Z") as EpochMs;
    const laterDay = Date.parse("2026-11-28T17:00:00Z") as EpochMs;

    await toggleChecklistItemCompletion(db, {
      itemId,
      at: firstDay,
      timezone: "America/New_York" as IanaTimezone,
      now: firstDay,
    });
    await toggleChecklistItemCompletion(db, {
      itemId,
      at: laterDay,
      timezone: "America/New_York" as IanaTimezone,
      now: laterDay,
    });

    const completions = await db.checklistCompletions.where("checklistItemId").equals(itemId).toArray();
    expect(completions).toHaveLength(1);
    expect(completions[0]?.deletedAt).toBe(laterDay);
  });

  it("writes a started fast and its queued mutation in one transaction", async () => {
    const result = await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });

    expect(result.ok).toBe(true);
    expect(await db.fasts.get(FAST_ID)).toMatchObject({ id: FAST_ID, endAt: null });
    expect(await db.mutations.toArray()).toMatchObject([
      { entityType: "fast", entityId: FAST_ID, operation: "start", sequence: 1, dataGeneration: 1 },
    ]);
  });

  it("rolls back the fast when queuing its mutation fails", async () => {
    const add = db.mutations.add.bind(db.mutations);
    db.mutations.add = (() => {
      throw new Error("mutation write failed");
    }) as typeof db.mutations.add;

    await expect(startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW })).rejects.toThrow(
      "mutation write failed",
    );
    expect(await db.fasts.count()).toBe(0);
    db.mutations.add = add;
  });

  it("resets stale sending mutations to pending after restart", async () => {
    const result = await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    if (!result.ok) throw new Error(result.message);
    await markMutationsSending(db, [result.value.mutation.mutationId]);
    db.close();

    db = await openLocalDatabase(name);

    expect((await db.mutations.toArray())[0]?.status).toBe("pending");
  });

  it("applies the same server change twice without duplicate rows", async () => {
    const state = {
      acknowledgedMutationIds: [],
      changes: [{ revision: 1, entityType: "fast" as const, entityId: FAST_ID, record: fast() }],
      cursor: 1,
      serverGeneration: 1,
      dataGeneration: 1,
      credentialGeneration: 1,
      now: NOW,
    };

    await applyServerState(db, state);
    await applyServerState(db, state);

    expect(await db.fasts.toArray()).toEqual([fast()]);
  });

  it("applies remote category reassignment with its deletion change", async () => {
    const categoryId = "60000000-0000-4000-8000-000000000201" as never;
    const replacementCategoryId = "60000000-0000-4000-8000-000000000202" as never;
    const metadata = { logId: LOG_ID, revision: 0, updatedAt: NOW, deletedAt: null };
    await db.categories.bulkPut([
      { ...metadata, id: categoryId, kind: "food", name: "Pantry", sortOrder: 0 },
      { ...metadata, id: replacementCategoryId, kind: "food", name: "Other", sortOrder: 1 },
    ]);
    const foodId = "60000000-0000-4000-8000-000000000203" as never;
    await db.foods.put({
      ...metadata,
      id: foodId,
      name: "Beans",
      serving: "1 can",
      categoryId,
      calories: 395,
      proteinGrams: null,
      fiberGrams: null,
      priceCents: null,
      externalUrl: null,
      imageAssetId: null,
    });

    await applyServerState(db, {
      acknowledgedMutationIds: [],
      changes: [{
        revision: 1,
        entityType: "category",
        entityId: categoryId,
        record: null,
        replacementCategoryId,
      }],
      cursor: 1,
      serverGeneration: 1,
      dataGeneration: 1,
      credentialGeneration: 1,
      now: NOW,
    });

    expect(await db.categories.get(categoryId)).toBeUndefined();
    expect(await db.foods.get(foodId)).toMatchObject({ categoryId: replacementCategoryId });
  });

  it("removes only acknowledged mutations", async () => {
    const first = await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    if (!first.ok) throw new Error(first.message);
    await deleteFast(db, { id: FAST_ID, now: NOW });

    await applyServerState(db, {
      acknowledgedMutationIds: [first.value.mutation.mutationId],
      changes: [],
      cursor: 0,
      serverGeneration: 1,
      dataGeneration: 1,
      credentialGeneration: 1,
      now: NOW,
    });

    expect(await db.mutations.count()).toBe(1);
    expect((await db.mutations.toArray())[0]?.operation).toBe("delete");
  });

  it("replaces old rows and discards old-generation mutations on a generation reset", async () => {
    await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    const replacementFast = fast(OTHER_FAST_ID, 4);

    await applyServerState(db, {
      acknowledgedMutationIds: [],
      changes: [],
      cursor: 4,
      serverGeneration: 2,
      dataGeneration: 2,
      credentialGeneration: 1,
      snapshot: snapshot({ cursor: 4, serverGeneration: 2, dataGeneration: 2, fasts: [replacementFast] }),
      now: NOW,
    });

    expect(await db.fasts.toArray()).toEqual([replacementFast]);
    expect(await db.mutations.count()).toBe(0);
    expect((await db.meta.get("state"))?.dataGeneration).toBe(2);
  });

  it("replaces every v2 collection and stale mutation on a generation mismatch", async () => {
    const oldMeal: MealRecord = {
      id: "60000000-0000-4000-8000-000000000011" as MealId,
      logId: LOG_ID,
      eatenAt: 1_000 as EpochMs,
      items: [{ foodId: null, name: "Old", quantity: 1, caloriesPerServing: 100, proteinGramsPerServing: null, fiberGramsPerServing: null }],
      imageAssetId: null,
      revision: 0,
      updatedAt: NOW,
      deletedAt: null,
    };
    const replacementMeal: MealRecord = {
      ...oldMeal,
      id: "60000000-0000-4000-8000-000000000012" as MealId,
      items: [{ ...oldMeal.items[0]!, name: "Replacement" }],
      revision: 4,
    };
    await saveDailyLogRecord(db, "meal", oldMeal, NOW);

    await applyServerState(db, {
      acknowledgedMutationIds: [],
      changes: [],
      cursor: 4,
      serverGeneration: 2,
      dataGeneration: 2,
      credentialGeneration: 1,
      snapshot: snapshot({
        cursor: 4,
        serverGeneration: 2,
        dataGeneration: 2,
        meals: [replacementMeal],
      }),
      now: NOW,
    });

    expect(await db.meals.toArray()).toEqual([replacementMeal]);
    expect(await db.mutations.count()).toBe(0);
  });

  it("queues restore as a compensating mutation for Undo", async () => {
    await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    await deleteFast(db, { id: FAST_ID, now: NOW });

    const restored = await restoreFast(db, { id: FAST_ID, now: NOW });

    expect(restored.ok).toBe(true);
    expect((await db.mutations.orderBy("sequence").toArray()).map((item) => item.operation)).toEqual([
      "start",
      "delete",
      "restore",
    ]);
  });

  it("queues resume as a compensating mutation for ending Undo", async () => {
    await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    await endFast(db, { endAt: 2_000 as EpochMs, now: NOW });

    const resumed = await resumeFast(db, { id: FAST_ID, now: NOW });

    expect(resumed.ok).toBe(true);
    expect((await db.fasts.get(FAST_ID))?.endAt).toBeNull();
    expect((await db.mutations.orderBy("sequence").toArray()).map((item) => item.operation)).toEqual([
      "start",
      "end",
      "resume",
    ]);
  });

  it("rejects a second active fast", async () => {
    await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });

    const second = await startFast(db, { id: OTHER_FAST_ID, startAt: 2_000 as EpochMs, goalHours: 16, now: NOW });

    expect(second).toMatchObject({ ok: false, code: "active_fast_exists" });
    expect(await db.fasts.count()).toBe(1);
    expect(await db.mutations.count()).toBe(1);
  });

  it("keeps the single-active rule when starts race", async () => {
    const [first, second] = await Promise.all([
      startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW }),
      startFast(db, { id: OTHER_FAST_ID, startAt: 2_000 as EpochMs, goalHours: 16, now: NOW }),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({ code: "active_fast_exists" });
    expect(await db.fasts.count()).toBe(1);
    expect(await db.mutations.count()).toBe(1);
  });

  it("keeps mutation payloads free of credential fields", async () => {
    await startFast(db, { id: FAST_ID, startAt: 1_000 as EpochMs, goalHours: 16, now: NOW });
    const rows = await db.transaction("r", db.fasts, db.weights, db.preferences, db.mutations, async () => ({
      fasts: await db.fasts.toArray(),
      weights: await db.weights.toArray(),
      preferences: await db.preferences.toArray(),
      mutations: await db.mutations.toArray(),
    }));

    expect(JSON.stringify(rows)).not.toMatch(/secret|credential/i);
  });
});
