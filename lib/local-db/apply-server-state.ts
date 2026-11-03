import type { Table } from "dexie";

import type {
  ActivityRecord,
  CategoryRecord,
  ChecklistCompletionRecord,
  ChecklistItemRecord,
  ExerciseRecord,
  FastRecord,
  FoodRecord,
  GroceryItemRecord,
  LogId,
  LogPreferences,
  MealRecord,
  MutationId,
  NutritionTargets,
  ValidationResult,
  WeightRecord,
} from "../domain/types";
import { validateSnapshotReferences } from "../settings/data";
import {
  validateFastCollection,
  validateFastRecord,
  validateLogPreferences,
  validateWeightRecord,
} from "../validation/domain";
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
import type { FastidiousDatabase } from "./database";
import {
  META_KEY,
  PREFERENCES_KEY,
  type DailyLogEntity,
  type LocalMutation,
  type ServerChange,
  type ServerSnapshot,
} from "./schema";

export interface ApplyServerStateInput {
  acknowledgedMutationIds: readonly MutationId[];
  changes: readonly ServerChange[];
  cursor: number;
  serverGeneration: number;
  dataGeneration: number;
  credentialGeneration: number;
  snapshot?: ServerSnapshot;
  now: number;
}

function touchedEntity(mutation: LocalMutation): string {
  return `${mutation.entityType}:${mutation.entityId}`;
}

function validateFast(record: FastRecord, logId: LogId, now: number): FastRecord {
  const result = validateFastRecord(record, now);
  if (!result.ok) throw new Error(`Invalid server fast: ${result.code}`);
  if (result.value.logId !== logId) throw new Error("Server fast belongs to a different log.");
  return result.value;
}

function validateWeight(record: WeightRecord, logId: LogId, now: number): WeightRecord {
  const result = validateWeightRecord(record, now);
  if (!result.ok) throw new Error(`Invalid server weight: ${result.code}`);
  if (result.value.logId !== logId) throw new Error("Server weight belongs to a different log.");
  return result.value;
}

function validatePreferences(preferences: LogPreferences): LogPreferences {
  const result = validateLogPreferences(preferences);
  if (!result.ok) throw new Error(`Invalid server preferences: ${result.code}`);
  return result.value;
}

type DailyLogRecord =
  | CategoryRecord
  | FoodRecord
  | MealRecord
  | ActivityRecord
  | ExerciseRecord
  | ChecklistItemRecord
  | ChecklistCompletionRecord
  | GroceryItemRecord;

function validateDailyRecord(entity: DailyLogEntity, record: unknown, logId: LogId, now: number): DailyLogRecord {
  let result: ValidationResult<DailyLogRecord>;
  switch (entity) {
    case "category": result = validateCategoryRecord(record); break;
    case "food": result = validateFoodRecord(record); break;
    case "meal": result = validateMealRecord(record, now); break;
    case "activity": result = validateActivityRecord(record); break;
    case "exercise": result = validateExerciseRecord(record, now); break;
    case "checklistItem": result = validateChecklistItemRecord(record); break;
    case "checklistCompletion": result = validateChecklistCompletionRecord(record, now); break;
    case "groceryItem": result = validateGroceryItemRecord(record); break;
  }
  if (!result.ok) throw new Error(`Invalid server ${entity}: ${result.code}`);
  if (result.value.logId !== logId) throw new Error(`Server ${entity} belongs to a different log.`);
  return result.value;
}

function validateTargets(targets: NutritionTargets): NutritionTargets {
  const result = validateNutritionTargets(targets);
  if (!result.ok) throw new Error(`Invalid server nutrition targets: ${result.code}`);
  return result.value;
}

const DAILY_LOG_ENTITIES = new Set<DailyLogEntity>([
  "category", "food", "meal", "activity", "exercise", "checklistItem", "checklistCompletion", "groceryItem",
]);

function isDailyLogEntity(value: string): value is DailyLogEntity {
  return DAILY_LOG_ENTITIES.has(value as DailyLogEntity);
}

function dailyTable(db: FastidiousDatabase, entity: DailyLogEntity): Table<DailyLogRecord, string> {
  return ({
    category: db.categories,
    food: db.foods,
    meal: db.meals,
    activity: db.activities,
    exercise: db.exercise,
    checklistItem: db.checklistItems,
    checklistCompletion: db.checklistCompletions,
    groceryItem: db.groceryItems,
  }[entity]) as unknown as Table<DailyLogRecord, string>;
}

export async function applyServerState(db: FastidiousDatabase, input: ApplyServerStateInput): Promise<void> {
  const meta = await db.meta.get(META_KEY);
  if (!meta?.logId) throw new Error("Cannot apply server state without an active log.");
  if (input.dataGeneration !== meta.dataGeneration && !input.snapshot) {
    throw new Error("A full snapshot is required when the data generation changes.");
  }
  if (
    input.snapshot &&
    (input.snapshot.cursor !== input.cursor ||
      input.snapshot.serverGeneration !== input.serverGeneration ||
      input.snapshot.dataGeneration !== input.dataGeneration ||
      input.snapshot.credentialGeneration !== input.credentialGeneration)
  ) {
    throw new Error("Server snapshot metadata does not match the sync response.");
  }

  await db.transaction(
    "rw",
    [
      db.meta, db.fasts, db.weights, db.categories, db.foods, db.meals, db.activities, db.exercise,
      db.checklistItems, db.checklistCompletions, db.groceryItems, db.nutritionTargets,
      db.preferences, db.mutations, db.preImportBackup,
    ],
    async () => {
      if (input.acknowledgedMutationIds.length > 0) {
        const acknowledged = await db.mutations.bulkGet([...input.acknowledgedMutationIds]);
        if (acknowledged.some((mutation) => mutation?.entityType === "log" && mutation.operation === "replace")) {
          await db.preImportBackup.clear();
        }
        await db.mutations.bulkDelete([...input.acknowledgedMutationIds]);
      }

      await db.mutations.where("dataGeneration").notEqual(input.dataGeneration).delete();
      const localMutations = await db.mutations.where("dataGeneration").equals(input.dataGeneration).toArray();
      const touched = new Set(localMutations.map(touchedEntity));

      if (input.snapshot) {
        if (input.snapshot.logId !== meta.logId) throw new Error("Server snapshot belongs to a different log.");
        const preservedFasts = (await db.fasts.toArray()).filter((record) => touched.has(`fast:${record.id}`));
        const preservedWeights = (await db.weights.toArray()).filter((record) => touched.has(`weight:${record.id}`));
        const preservedDaily = new Map<DailyLogEntity, DailyLogRecord[]>();
        for (const entity of DAILY_LOG_ENTITIES) {
          preservedDaily.set(entity, (await dailyTable(db, entity).toArray()).filter((record) => touched.has(`${entity}:${record.id}`)));
        }
        const preservedPreferences = touched.has(`preferences:${PREFERENCES_KEY}`)
          ? await db.preferences.get(PREFERENCES_KEY)
          : undefined;
        const preservedTargets = touched.has(`nutritionTargets:${PREFERENCES_KEY}`)
          ? await db.nutritionTargets.get(PREFERENCES_KEY)
          : undefined;

        const snapshotFasts = input.snapshot.fasts.map((record) => validateFast(record, meta.logId!, input.now));
        const snapshotFastCollection = validateFastCollection(snapshotFasts);
        if (!snapshotFastCollection.ok) throw new Error(`Invalid server fasts: ${snapshotFastCollection.code}`);
        const snapshotWeights = input.snapshot.weights.map((record) => validateWeight(record, meta.logId!, input.now));
        const snapshotDaily = new Map<DailyLogEntity, DailyLogRecord[]>([
          ["category", input.snapshot.categories.map((record) => validateDailyRecord("category", record, meta.logId!, input.now))],
          ["food", input.snapshot.foods.map((record) => validateDailyRecord("food", record, meta.logId!, input.now))],
          ["meal", input.snapshot.meals.map((record) => validateDailyRecord("meal", record, meta.logId!, input.now))],
          ["activity", input.snapshot.activities.map((record) => validateDailyRecord("activity", record, meta.logId!, input.now))],
          ["exercise", input.snapshot.exercise.map((record) => validateDailyRecord("exercise", record, meta.logId!, input.now))],
          ["checklistItem", input.snapshot.checklistItems.map((record) => validateDailyRecord("checklistItem", record, meta.logId!, input.now))],
          ["checklistCompletion", input.snapshot.checklistCompletions.map((record) => validateDailyRecord("checklistCompletion", record, meta.logId!, input.now))],
          ["groceryItem", input.snapshot.groceryItems.map((record) => validateDailyRecord("groceryItem", record, meta.logId!, input.now))],
        ]);
        const references = validateSnapshotReferences(input.snapshot);
        if (!references.ok) throw new Error(`Invalid server snapshot links: ${references.code}`);

        await db.fasts.clear();
        await db.weights.clear();
        if (snapshotFasts.length > 0) await db.fasts.bulkPut(snapshotFasts);
        if (snapshotWeights.length > 0) await db.weights.bulkPut(snapshotWeights);
        if (preservedFasts.length > 0) await db.fasts.bulkPut(preservedFasts);
        if (preservedWeights.length > 0) await db.weights.bulkPut(preservedWeights);
        for (const entity of DAILY_LOG_ENTITIES) {
          const table = dailyTable(db, entity);
          await table.clear();
          const records = [...(snapshotDaily.get(entity) ?? []), ...(preservedDaily.get(entity) ?? [])];
          if (records.length > 0) await table.bulkPut(records);
        }
        await db.preferences.put({
          key: PREFERENCES_KEY,
          ...validatePreferences(input.snapshot.preferences),
          ...preservedPreferences,
        });
        await db.nutritionTargets.put({
          key: PREFERENCES_KEY,
          ...validateTargets(input.snapshot.nutritionTargets),
          ...preservedTargets,
        });
        await db.preImportBackup.clear();
      }

      for (const change of input.changes) {
        if (change.revision > input.cursor) throw new Error("Server change revision exceeds the returned cursor.");
        if (touched.has(`${change.entityType}:${change.entityId}`)) continue;
        if (change.entityType === "fast") {
          if (change.record === null) await db.fasts.delete(change.entityId);
          else {
            if (change.record.id !== change.entityId) throw new Error("Server fast change has a mismatched entity ID.");
            await db.fasts.put(validateFast(change.record, meta.logId!, input.now));
          }
        } else if (change.entityType === "weight") {
          if (change.record === null) await db.weights.delete(change.entityId);
          else {
            if (change.record.id !== change.entityId) throw new Error("Server weight change has a mismatched entity ID.");
            await db.weights.put(validateWeight(change.record, meta.logId!, input.now));
          }
        } else if (change.entityType === "preferences") {
          await db.preferences.put({ key: PREFERENCES_KEY, ...validatePreferences(change.record) });
        } else if (change.entityType === "nutritionTargets") {
          await db.nutritionTargets.put({ key: PREFERENCES_KEY, ...validateTargets(change.record) });
        } else if (isDailyLogEntity(change.entityType)) {
          const table = dailyTable(db, change.entityType);
          if (change.record === null) {
            if (change.entityType === "category") {
              if (!change.replacementCategoryId) throw new Error("Deleted category change is missing its replacement.");
              await db.foods.where("categoryId").equals(change.entityId).modify({ categoryId: change.replacementCategoryId });
              await db.activities.where("categoryId").equals(change.entityId).modify({ categoryId: change.replacementCategoryId });
            } else if (change.entityType === "checklistItem") {
              await db.checklistCompletions.where("checklistItemId").equals(change.entityId).delete();
            } else if (change.entityType === "food") {
              await db.groceryItems.where("foodId").equals(change.entityId).modify({ foodId: null });
            } else if (change.entityType === "activity") {
              await db.exercise.where("activityId").equals(change.entityId).modify({ activityId: null });
            }
            await table.delete(change.entityId);
          } else {
            if (change.record.id !== change.entityId) throw new Error(`Server ${change.entityType} change has a mismatched entity ID.`);
            await table.put(validateDailyRecord(change.entityType, change.record, meta.logId!, input.now));
          }
        }
      }

      await db.meta.update(META_KEY, {
        cursor: input.cursor,
        serverGeneration: input.serverGeneration,
        dataGeneration: input.dataGeneration,
        credentialGeneration: input.credentialGeneration,
        syncError: null,
        syncErrorCount: 0,
      });
    },
  );
}

export async function setMutationStatus(
  db: FastidiousDatabase,
  mutationIds: readonly MutationId[],
  status: LocalMutation["status"],
): Promise<void> {
  await db.transaction("rw", db.mutations, async () => {
    for (const id of mutationIds) await db.mutations.update(id, { status });
  });
}

export function markMutationsSending(db: FastidiousDatabase, mutationIds: readonly MutationId[]): Promise<void> {
  return setMutationStatus(db, mutationIds, "sending");
}
