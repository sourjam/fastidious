import type {
  ActivityRecord,
  CategoryRecord,
  ChecklistCompletionRecord,
  ChecklistItemRecord,
  EpochMs,
  ExerciseRecord,
  FastRecord,
  FoodRecord,
  GroceryItemRecord,
  LogId,
  MealRecord,
  MutationId,
  ValidationResult,
  WeightRecord,
} from "../domain/types";
import { emptyDailyLogSnapshot, type LocalSnapshot } from "../local-db/schema";
import { MAX_IMPORT_RANGE_MS, MAX_IMPORT_RECORDS, validateSnapshotReferences } from "../settings/data";
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
import { changedRows } from "./db.server";
import { databaseFailure, RepositoryError } from "./errors.server";

const SNAPSHOT_KEYS = [
  "fasts", "weights", "categories", "foods", "meals", "activities", "exercise",
  "checklistItems", "checklistCompletions", "groceryItems", "nutritionTargets", "preferences",
] as const;

function checkedCollection<T>(
  values: unknown,
  keys: readonly string[],
  validator: (value: unknown) => ValidationResult<T>,
  label: string,
): T[] {
  if (!Array.isArray(values) || values.length > MAX_IMPORT_RECORDS) {
    throw new RepositoryError("validation_failure", `Replacement ${label} collection is invalid.`);
  }
  return values.map((value) => {
    if (!hasExactKeys(value, keys)) {
      throw new RepositoryError("validation_failure", `Replacement ${label} fields are invalid.`);
    }
    const checked = validator(value);
    if (!checked.ok) throw new RepositoryError("validation_failure", checked.message);
    return checked.value;
  });
}

export function validateDataReplacement(payload: unknown, logId: LogId, now: number): LocalSnapshot {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new RepositoryError("validation_failure", "Replacement data is invalid.");
  }
  const input = payload as Record<string, unknown>;
  const legacy = hasExactKeys(input, ["fasts", "weights", "preferences"]);
  if (!legacy && !hasExactKeys(input, SNAPSHOT_KEYS)) {
    throw new RepositoryError("validation_failure", "Replacement data is invalid.");
  }
  if (!hasExactKeys(input.preferences, ["timezone", "theme", "weightUnit", "defaultGoalHours"])) {
    throw new RepositoryError("validation_failure", "Replacement preferences are invalid.");
  }
  const preferences = validateLogPreferences(input.preferences);
  if (!preferences.ok) throw new RepositoryError("validation_failure", preferences.message);

  const fasts = checkedCollection(
    input.fasts,
    ["id", "logId", "startAt", "endAt", "goalHours", "revision", "updatedAt", "deletedAt"],
    (value) => validateFastRecord({ ...(value as object), logId }, now),
    "fast",
  );
  const fastCollection = validateFastCollection(fasts);
  if (!fastCollection.ok) throw new RepositoryError("validation_failure", fastCollection.message);
  const weights = checkedCollection(
    input.weights,
    ["id", "logId", "measuredAt", "kilograms", "revision", "updatedAt", "deletedAt"],
    (value) => validateWeightRecord({ ...(value as object), logId }, now),
    "weight",
  );

  const v2 = legacy ? emptyDailyLogSnapshot() : input;
  const categories = checkedCollection(
    v2.categories,
    ["id", "logId", "kind", "name", "sortOrder", "revision", "updatedAt", "deletedAt"],
    (value) => validateCategoryRecord({ ...(value as object), logId }),
    "category",
  );
  const foods = checkedCollection(
    v2.foods,
    ["id", "logId", "name", "serving", "categoryId", "calories", "proteinGrams", "fiberGrams", "priceCents", "externalUrl", "imageAssetId", "revision", "updatedAt", "deletedAt"],
    (value) => validateFoodRecord({ ...(value as object), logId }),
    "food",
  );
  const meals = checkedCollection(
    v2.meals,
    ["id", "logId", "eatenAt", "items", "imageAssetId", "revision", "updatedAt", "deletedAt"],
    (value) => validateMealRecord({ ...(value as object), logId }, now),
    "meal",
  );
  const activities = checkedCollection(
    v2.activities,
    ["id", "logId", "name", "detail", "categoryId", "externalUrl", "imageAssetId", "revision", "updatedAt", "deletedAt"],
    (value) => validateActivityRecord({ ...(value as object), logId }),
    "activity",
  );
  const exercise = checkedCollection(
    v2.exercise,
    ["id", "logId", "activityId", "text", "performedAt", "revision", "updatedAt", "deletedAt"],
    (value) => validateExerciseRecord({ ...(value as object), logId }, now),
    "exercise",
  );
  const checklistItems = checkedCollection(
    v2.checklistItems,
    ["id", "logId", "name", "cadence", "externalUrl", "imageAssetId", "sortOrder", "revision", "updatedAt", "deletedAt"],
    (value) => validateChecklistItemRecord({ ...(value as object), logId }),
    "checklist item",
  );
  const checklistCompletions = checkedCollection(
    v2.checklistCompletions,
    ["id", "logId", "checklistItemId", "periodKey", "completedAt", "revision", "updatedAt", "deletedAt"],
    (value) => validateChecklistCompletionRecord({ ...(value as object), logId }, now),
    "checklist completion",
  );
  const groceryItems = checkedCollection(
    v2.groceryItems,
    ["id", "logId", "foodId", "name", "inCart", "externalUrl", "imageAssetId", "revision", "updatedAt", "deletedAt"],
    (value) => validateGroceryItemRecord({ ...(value as object), logId }),
    "grocery item",
  );
  const targets = validateNutritionTargets(v2.nutritionTargets);
  if (!targets.ok) throw new RepositoryError("validation_failure", targets.message);

  const dates = [
    ...fasts.flatMap((fast) => [fast.startAt, fast.endAt ?? now]),
    ...weights.map((weight) => weight.measuredAt),
    ...meals.map((meal) => meal.eatenAt),
    ...exercise.map((entry) => entry.performedAt),
    ...checklistCompletions.map((completion) => completion.completedAt),
  ];
  if (dates.length > 0 && Math.max(...dates) - Math.min(...dates) > MAX_IMPORT_RANGE_MS) {
    throw new RepositoryError("validation_failure", "Replacement records span too large a date range.");
  }
  const snapshot: LocalSnapshot = {
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
  };
  const references = validateSnapshotReferences(snapshot);
  if (!references.ok) throw new RepositoryError("validation_failure", references.message);
  return references.value;
}

export async function resetServerData(
  db: D1Database,
  input: {
    logId: LogId;
    mutationId: MutationId;
    expectedGeneration: number;
    operation: "clear" | "replace";
    replacement?: LocalSnapshot;
    now: number;
  },
): Promise<number> {
  if (!Number.isInteger(input.expectedGeneration) || input.expectedGeneration < 2 || !Number.isInteger(input.now) || input.now < 0) {
    throw new RepositoryError("validation_failure", "Data reset metadata is invalid.");
  }
  if (input.operation === "replace" && !input.replacement) {
    throw new RepositoryError("validation_failure", "Replacement data is required.");
  }
  const replacement = input.replacement;
  if (replacement) {
    const imageIds = new Set([
      ...replacement.foods.map((record) => record.imageAssetId),
      ...replacement.meals.map((record) => record.imageAssetId),
      ...replacement.activities.map((record) => record.imageAssetId),
      ...replacement.checklistItems.map((record) => record.imageAssetId),
      ...replacement.groceryItems.map((record) => record.imageAssetId),
    ].filter((id): id is NonNullable<typeof id> => id !== null));
    if (imageIds.size > 0) {
      throw new RepositoryError("validation_failure", "Replacement data cannot transfer image references.");
    }
  }
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE logs
       SET data_generation = ?, revision = revision + 1, updated_at = ?,
           timezone = CASE WHEN ? = 'replace' THEN ? ELSE timezone END,
           theme = CASE WHEN ? = 'replace' THEN ? ELSE theme END,
           weight_unit = CASE WHEN ? = 'replace' THEN ? ELSE weight_unit END,
           default_goal_hours = CASE WHEN ? = 'replace' THEN ? ELSE default_goal_hours END,
           target_calories = CASE WHEN ? = 'replace' THEN ? ELSE NULL END,
           target_protein_grams = CASE WHEN ? = 'replace' THEN ? ELSE NULL END,
           target_fiber_grams = CASE WHEN ? = 'replace' THEN ? ELSE NULL END
       WHERE id = ? AND data_generation = ?`,
    ).bind(
      input.expectedGeneration,
      input.now,
      input.operation,
      replacement?.preferences.timezone ?? "UTC",
      input.operation,
      replacement?.preferences.theme ?? "system",
      input.operation,
      replacement?.preferences.weightUnit ?? "kg",
      input.operation,
      replacement?.preferences.defaultGoalHours ?? 16,
      input.operation,
      replacement?.nutritionTargets.calories ?? null,
      input.operation,
      replacement?.nutritionTargets.proteinGrams ?? null,
      input.operation,
      replacement?.nutritionTargets.fiberGrams ?? null,
      input.logId,
      input.expectedGeneration - 1,
    ),
    db.prepare(
      "UPDATE notification_jobs SET status = 'cancelled' WHERE log_id = ? AND EXISTS (SELECT 1 FROM logs WHERE id = ? AND data_generation = ?)",
    ).bind(input.logId, input.logId, input.expectedGeneration),
    db.prepare(
      "UPDATE image_assets SET status = 'pending_delete', delete_after = ?, updated_at = ? WHERE log_id = ? AND EXISTS (SELECT 1 FROM logs WHERE id = ? AND data_generation = ?)",
    ).bind(input.now + 24 * 60 * 60 * 1_000, input.now, input.logId, input.logId, input.expectedGeneration),
  ];

  for (const table of [
    "checklist_completions", "exercise_entries", "grocery_items", "meals", "foods", "activities",
    "checklist_items", "categories", "fasts", "weights",
  ]) {
    statements.push(db.prepare(
      `DELETE FROM ${table} WHERE log_id = ? AND EXISTS (SELECT 1 FROM logs WHERE id = ? AND data_generation = ?)`,
    ).bind(input.logId, input.logId, input.expectedGeneration));
  }

  if (replacement) {
    for (const category of replacement.categories.filter(active)) statements.push(insertCategory(db, input.logId, category, input.expectedGeneration, input.now));
    for (const checklistItem of replacement.checklistItems.filter(active)) statements.push(insertChecklistItem(db, input.logId, checklistItem, input.expectedGeneration, input.now));
    for (const food of replacement.foods.filter(active)) statements.push(insertFood(db, input.logId, food, input.expectedGeneration, input.now));
    for (const activity of replacement.activities.filter(active)) statements.push(insertActivity(db, input.logId, activity, input.expectedGeneration, input.now));
    for (const meal of replacement.meals.filter(active)) statements.push(insertMeal(db, input.logId, meal, input.expectedGeneration, input.now));
    for (const entry of replacement.exercise.filter(active)) statements.push(insertExercise(db, input.logId, entry, input.expectedGeneration, input.now));
    for (const completion of replacement.checklistCompletions.filter(active)) statements.push(insertChecklistCompletion(db, input.logId, completion, input.expectedGeneration, input.now));
    for (const grocery of replacement.groceryItems.filter(active)) statements.push(insertGrocery(db, input.logId, grocery, input.expectedGeneration, input.now));
    for (const fast of replacement.fasts.filter(active)) statements.push(insertFast(db, input.logId, fast, input.expectedGeneration, input.now));
    for (const weight of replacement.weights.filter(active)) statements.push(insertWeight(db, input.logId, weight, input.expectedGeneration, input.now));
  }
  statements.push(
    db.prepare(
      `INSERT INTO changes (log_id, revision, entity_type, entity_id, operation, payload, created_at)
       SELECT id, revision, 'generation', id, 'reset', json_object('dataGeneration', data_generation), ?
       FROM logs WHERE id = ? AND data_generation = ?`,
    ).bind(input.now, input.logId, input.expectedGeneration),
    db.prepare(
      `INSERT INTO mutation_receipts (log_id, mutation_id, applied_revision, created_at)
       SELECT id, ?, revision, ? FROM logs WHERE id = ? AND data_generation = ?`,
    ).bind(input.mutationId, input.now, input.logId, input.expectedGeneration),
    db.prepare("SELECT revision FROM logs WHERE id = ? AND data_generation = ?").bind(input.logId, input.expectedGeneration),
  );

  try {
    const results = await db.batch<{ revision?: number }>(statements);
    if (changedRows(results[0]!) === 0) {
      throw new RepositoryError("generation_mismatch", "Data generation has changed.");
    }
    const revision = results.at(-1)?.results[0]?.revision;
    if (revision === undefined) throw new RepositoryError("not_found", "Log was not found.");
    return Number(revision);
  } catch (cause) {
    if (cause instanceof RepositoryError) throw cause;
    throw databaseFailure(cause);
  }
}

function active(record: { deletedAt: EpochMs | null }): boolean {
  return record.deletedAt === null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => actual[index] === key);
}

function insertFast(db: D1Database, logId: LogId, value: FastRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO fasts (id, log_id, start_at, end_at, goal_hours, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.startAt, value.endAt, value.goalHours, now, logId, generation);
}

function insertWeight(db: D1Database, logId: LogId, value: WeightRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO weights (id, log_id, measured_at, kilograms, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.measuredAt, value.kilograms, now, logId, generation);
}

function insertCategory(db: D1Database, logId: LogId, value: CategoryRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO categories (id, log_id, kind, name, sort_order, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.kind, value.name, value.sortOrder, now, logId, generation);
}

function insertFood(db: D1Database, logId: LogId, value: FoodRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO foods (id, log_id, name, serving, category_id, calories, protein_grams, fiber_grams, price_cents, external_url, image_asset_id, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(
    value.id, value.name, value.serving, value.categoryId, value.calories, value.proteinGrams, value.fiberGrams,
    value.priceCents, value.externalUrl, value.imageAssetId, now, logId, generation,
  );
}

function insertMeal(db: D1Database, logId: LogId, value: MealRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO meals (id, log_id, eaten_at, items_json, image_asset_id, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.eatenAt, JSON.stringify(value.items), value.imageAssetId, now, logId, generation);
}

function insertActivity(db: D1Database, logId: LogId, value: ActivityRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO activities (id, log_id, name, detail, category_id, external_url, image_asset_id, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.name, value.detail, value.categoryId, value.externalUrl, value.imageAssetId, now, logId, generation);
}

function insertExercise(db: D1Database, logId: LogId, value: ExerciseRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO exercise_entries (id, log_id, activity_id, text, performed_at, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.activityId, value.text, value.performedAt, now, logId, generation);
}

function insertChecklistItem(db: D1Database, logId: LogId, value: ChecklistItemRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO checklist_items (id, log_id, name, cadence, external_url, image_asset_id, sort_order, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.name, value.cadence, value.externalUrl, value.imageAssetId, value.sortOrder, now, logId, generation);
}

function insertChecklistCompletion(db: D1Database, logId: LogId, value: ChecklistCompletionRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO checklist_completions (id, log_id, checklist_item_id, period_key, completed_at, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.checklistItemId, value.periodKey, value.completedAt, now, logId, generation);
}

function insertGrocery(db: D1Database, logId: LogId, value: GroceryItemRecord, generation: number, now: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO grocery_items (id, log_id, food_id, name, in_cart, external_url, image_asset_id, revision, updated_at, deleted_at)
     SELECT ?, id, ?, ?, ?, ?, ?, revision, ?, NULL FROM logs WHERE id = ? AND data_generation = ?`,
  ).bind(value.id, value.foodId, value.name, value.inCart ? 1 : 0, value.externalUrl, value.imageAssetId, now, logId, generation);
}
