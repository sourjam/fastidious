import Dexie from "dexie";

import type { LogId, ValidationResult } from "../domain/types";
import { validateSnapshotReferences } from "../settings/data";
import { validateFastCollection, validateFastRecord, validateLogPreferences, validateWeightRecord } from "../validation/domain";
import {
  validateActivityRecord,
  validateCategoryRecord,
  validateChecklistCompletionRecord,
  validateChecklistItemRecord,
  validateExerciseRecord,
  validateFoodRecord,
  validateGroceryItemRecord,
  validateMealRecord,
  validateNutritionTargets,
} from "../validation/daily-log";
import {
  DATABASE_CLOSE_MESSAGE,
  DATABASE_CONTROL_CHANNEL,
  type FastidiousDatabase,
} from "./database";
import { META_KEY, PREFERENCES_KEY, type ServerSnapshot } from "./schema";

function validateSnapshotRecords<T extends { logId: LogId }>(
  records: readonly unknown[],
  validator: (value: unknown) => ValidationResult<T>,
  logId: LogId,
  label: string,
): T[] {
  return records.map((record) => {
    const result = validator(record);
    if (!result.ok) throw new Error(`Invalid snapshot ${label}: ${result.code}`);
    if (result.value.logId !== logId) throw new Error(`Snapshot ${label} belongs to a different log.`);
    return result.value;
  });
}

export async function replaceActiveLog(
  db: FastidiousDatabase,
  snapshot: ServerSnapshot,
  now: number,
): Promise<void> {
  const current = await db.meta.get(META_KEY);
  if (!current) throw new Error("Local database metadata is missing.");
  const preferences = validateLogPreferences(snapshot.preferences);
  if (!preferences.ok) throw new Error(`Invalid snapshot preferences: ${preferences.code}`);
  const targets = validateNutritionTargets(snapshot.nutritionTargets);
  if (!targets.ok) throw new Error(`Invalid snapshot nutrition targets: ${targets.code}`);
  const fasts = snapshot.fasts.map((fast) => {
    const result = validateFastRecord(fast, now);
    if (!result.ok) throw new Error(`Invalid snapshot fast: ${result.code}`);
    if (result.value.logId !== snapshot.logId) throw new Error("Snapshot fast belongs to a different log.");
    return result.value;
  });
  const fastCollection = validateFastCollection(fasts);
  if (!fastCollection.ok) throw new Error(`Invalid snapshot fasts: ${fastCollection.code}`);
  const weights = snapshot.weights.map((weight) => {
    const result = validateWeightRecord(weight, now);
    if (!result.ok) throw new Error(`Invalid snapshot weight: ${result.code}`);
    if (result.value.logId !== snapshot.logId) throw new Error("Snapshot weight belongs to a different log.");
    return result.value;
  });
  const categories = validateSnapshotRecords(snapshot.categories, validateCategoryRecord, snapshot.logId, "category");
  const foods = validateSnapshotRecords(snapshot.foods, validateFoodRecord, snapshot.logId, "food");
  const meals = validateSnapshotRecords(snapshot.meals, (value) => validateMealRecord(value, now), snapshot.logId, "meal");
  const activities = validateSnapshotRecords(snapshot.activities, validateActivityRecord, snapshot.logId, "activity");
  const exercise = validateSnapshotRecords(snapshot.exercise, (value) => validateExerciseRecord(value, now), snapshot.logId, "exercise");
  const checklistItems = validateSnapshotRecords(snapshot.checklistItems, validateChecklistItemRecord, snapshot.logId, "checklist item");
  const checklistCompletions = validateSnapshotRecords(
    snapshot.checklistCompletions,
    (value) => validateChecklistCompletionRecord(value, now),
    snapshot.logId,
    "checklist completion",
  );
  const groceryItems = validateSnapshotRecords(snapshot.groceryItems, validateGroceryItemRecord, snapshot.logId, "grocery item");
  const references = validateSnapshotReferences({
    fasts,
    weights,
    categories,
    foods,
    meals,
    activities,
    exercise,
    checklistItems,
    checklistCompletions,
    groceryItems,
    nutritionTargets: targets.value,
    preferences: preferences.value,
  });
  if (!references.ok) throw new Error(`Invalid snapshot links: ${references.code}`);

  await db.transaction(
    "rw",
    [
      db.meta, db.fasts, db.weights, db.categories, db.foods, db.meals, db.activities, db.exercise,
      db.checklistItems, db.checklistCompletions, db.groceryItems, db.nutritionTargets,
      db.preferences, db.mutations, db.preImportBackup,
    ],
    async () => {
      await Promise.all([
        db.fasts.clear(), db.weights.clear(), db.categories.clear(), db.foods.clear(), db.meals.clear(),
        db.activities.clear(), db.exercise.clear(), db.checklistItems.clear(), db.checklistCompletions.clear(),
        db.groceryItems.clear(), db.nutritionTargets.clear(), db.preferences.clear(), db.mutations.clear(),
        db.preImportBackup.clear(),
      ]);
      if (fasts.length > 0) await db.fasts.bulkPut(fasts);
      if (weights.length > 0) await db.weights.bulkPut(weights);
      if (categories.length > 0) await db.categories.bulkPut(categories);
      if (foods.length > 0) await db.foods.bulkPut(foods);
      if (meals.length > 0) await db.meals.bulkPut(meals);
      if (activities.length > 0) await db.activities.bulkPut(activities);
      if (exercise.length > 0) await db.exercise.bulkPut(exercise);
      if (checklistItems.length > 0) await db.checklistItems.bulkPut(checklistItems);
      if (checklistCompletions.length > 0) await db.checklistCompletions.bulkPut(checklistCompletions);
      if (groceryItems.length > 0) await db.groceryItems.bulkPut(groceryItems);
      await db.nutritionTargets.put({ key: PREFERENCES_KEY, ...targets.value });
      await db.preferences.put({ key: PREFERENCES_KEY, ...preferences.value });
      await db.meta.put({
        ...current,
        logId: snapshot.logId,
        cursor: snapshot.cursor,
        serverGeneration: snapshot.serverGeneration,
        dataGeneration: snapshot.dataGeneration,
        credentialGeneration: snapshot.credentialGeneration,
        nextMutationSequence: 1,
        syncError: null,
        syncErrorCount: 0,
      });
    },
  );
}

async function deleteLocalDatabase(db: FastidiousDatabase, eraseRememberedCredential?: () => void | Promise<void>): Promise<void> {
  const name = db.name;
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(DATABASE_CONTROL_CHANNEL);
    channel.postMessage(DATABASE_CLOSE_MESSAGE);
    channel.close();
  }
  db.close();
  await Dexie.delete(name);
  await eraseRememberedCredential?.();
}

export function revokeAndErase(
  db: FastidiousDatabase,
  eraseRememberedCredential?: () => void | Promise<void>,
): Promise<void> {
  return deleteLocalDatabase(db, eraseRememberedCredential);
}

export async function removeFromDevice(
  db: FastidiousDatabase,
  unsubscribePush: () => void | Promise<void>,
  eraseRememberedCredential?: () => void | Promise<void>,
): Promise<void> {
  try {
    await unsubscribePush();
  } catch {
    // Removing local access must continue when best-effort push cleanup is unavailable.
  }
  await deleteLocalDatabase(db, eraseRememberedCredential);
}
