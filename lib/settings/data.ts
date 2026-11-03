import type {
  ActivityRecord,
  CategoryRecord,
  ChecklistCompletionRecord,
  ChecklistItemRecord,
  ExerciseRecord,
  FoodRecord,
  GroceryItemRecord,
  LogId,
  LogPreferences,
  MealRecord,
  NutritionTargets,
  ValidationResult,
} from "../domain/types";
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
import type { FastidiousDatabase } from "../local-db/database";
import { PREFERENCES_KEY, type LocalSnapshot } from "../local-db/schema";

export const EXPORT_VERSION = 2;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_RECORDS = 10_000;
export const MAX_IMPORT_RANGE_MS = 100 * 366 * 24 * 60 * 60 * 1_000;

type ExportedRecord<T> = Omit<T, "logId" | "revision" | "updatedAt" | "deletedAt">;

export interface ExportedFast {
  id: string;
  startAt: number;
  endAt: number | null;
  goalHours: number;
}

export interface ExportedWeight {
  id: string;
  measuredAt: number;
  kilograms: number;
}

export interface FastidiousExportV1 {
  app: "fastidious";
  version: 1;
  exportedAt: string;
  preferences: LogPreferences;
  fasts: ExportedFast[];
  weights: ExportedWeight[];
}

export interface FastidiousExport {
  app: "fastidious";
  version: 2;
  exportedAt: string;
  preferences: LogPreferences;
  nutritionTargets: NutritionTargets;
  fasts: ExportedFast[];
  weights: ExportedWeight[];
  categories: ExportedRecord<CategoryRecord>[];
  foods: ExportedRecord<FoodRecord>[];
  meals: ExportedRecord<MealRecord>[];
  activities: ExportedRecord<ActivityRecord>[];
  exercise: ExportedRecord<ExerciseRecord>[];
  checklistItems: ExportedRecord<ChecklistItemRecord>[];
  checklistCompletions: ExportedRecord<ChecklistCompletionRecord>[];
  groceryItems: ExportedRecord<GroceryItemRecord>[];
}

export interface ImportPreview {
  snapshot: LocalSnapshot;
  fastCount: number;
  weightCount: number;
  mealCount: number;
  foodCount: number;
  activityCount: number;
  exerciseCount: number;
  checklistItemCount: number;
  checklistCompletionCount: number;
  groceryItemCount: number;
  droppedImageCount: number;
  firstDate: number | null;
  lastDate: number | null;
  timezone: string;
  hasActiveFast: boolean;
  preferences: LogPreferences;
}

function failure(code: string, message: string): ValidationResult<never> {
  return { ok: false, code, message };
}

function exportRecord<T extends { logId: unknown; revision: unknown; updatedAt: unknown; deletedAt: unknown }>(
  record: T,
): ExportedRecord<T> {
  const { logId: _logId, revision: _revision, updatedAt: _updatedAt, deletedAt: _deletedAt, ...value } = record;
  return value;
}

function activeRecords<T extends { deletedAt: number | null }>(records: T[]): T[] {
  return records.filter((record) => record.deletedAt === null);
}

export async function buildExport(db: FastidiousDatabase, exportedAt = new Date()): Promise<FastidiousExport> {
  const [
    storedPreferences,
    storedTargets,
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
  ] = await Promise.all([
    db.preferences.get(PREFERENCES_KEY),
    db.nutritionTargets.get(PREFERENCES_KEY),
    db.fasts.toArray(),
    db.weights.toArray(),
    db.categories.toArray(),
    db.foods.toArray(),
    db.meals.toArray(),
    db.activities.toArray(),
    db.exercise.toArray(),
    db.checklistItems.toArray(),
    db.checklistCompletions.toArray(),
    db.groceryItems.toArray(),
  ]);
  if (!storedPreferences) throw new Error("Log preferences are not installed.");
  const { key: _key, ...preferences } = storedPreferences;
  const { key: _targetKey, ...nutritionTargets } = storedTargets ?? {
    key: PREFERENCES_KEY,
    calories: null,
    proteinGrams: null,
    fiberGrams: null,
  };
  return {
    app: "fastidious",
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    preferences,
    nutritionTargets,
    fasts: activeRecords(fasts)
      .sort((first, second) => first.startAt - second.startAt)
      .map(({ id, startAt, endAt, goalHours }) => ({ id, startAt, endAt, goalHours })),
    weights: activeRecords(weights)
      .sort((first, second) => first.measuredAt - second.measuredAt)
      .map(({ id, measuredAt, kilograms }) => ({ id, measuredAt, kilograms })),
    categories: activeRecords(categories).sort((a, b) => a.sortOrder - b.sortOrder).map(exportRecord),
    foods: activeRecords(foods).sort((a, b) => a.name.localeCompare(b.name)).map(exportRecord),
    meals: activeRecords(meals).sort((a, b) => a.eatenAt - b.eatenAt).map(exportRecord),
    activities: activeRecords(activities).sort((a, b) => a.name.localeCompare(b.name)).map(exportRecord),
    exercise: activeRecords(exercise).sort((a, b) => a.performedAt - b.performedAt).map(exportRecord),
    checklistItems: activeRecords(checklistItems).sort((a, b) => a.sortOrder - b.sortOrder).map(exportRecord),
    checklistCompletions: activeRecords(checklistCompletions).sort((a, b) => a.completedAt - b.completedAt).map(exportRecord),
    groceryItems: activeRecords(groceryItems).sort((a, b) => a.name.localeCompare(b.name)).map(exportRecord),
  };
}

export function exportFilename(exportedAt = new Date()): string {
  return `fastidious-${exportedAt.toISOString().slice(0, 10)}.json`;
}

const V1_KEYS = ["app", "version", "exportedAt", "preferences", "fasts", "weights"] as const;
const V2_KEYS = [
  ...V1_KEYS,
  "nutritionTargets",
  "categories",
  "foods",
  "meals",
  "activities",
  "exercise",
  "checklistItems",
  "checklistCompletions",
  "groceryItems",
] as const;

function importedRecord(value: unknown, keys: readonly string[], logId: LogId, now: number): Record<string, unknown> | null {
  return hasExactKeys(value, keys) ? { ...value, logId, revision: 0, updatedAt: now, deletedAt: null } : null;
}

function validateImportedCollection<T>(
  values: unknown[],
  keys: readonly string[],
  logId: LogId,
  now: number,
  validator: (value: unknown) => ValidationResult<T>,
  label: string,
): ValidationResult<T[]> {
  const records: T[] = [];
  for (const value of values) {
    const candidate = importedRecord(value, keys, logId, now);
    if (!candidate) return failure(`invalid_${label}`, `An imported ${label} has invalid fields.`);
    const checked = validator(candidate);
    if (!checked.ok) return checked;
    records.push(checked.value);
  }
  return { ok: true, value: records };
}

export function parseImport(text: string, logId: LogId, now: number): ValidationResult<ImportPreview> {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    return failure("import_too_large", "Import files must be 5 MB or smaller.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return failure("invalid_json", "Choose a valid Fastidious JSON export.");
  }
  if (!isObject(raw) || raw.app !== "fastidious" || (raw.version !== 1 && raw.version !== EXPORT_VERSION)) {
    return failure("unsupported_import", "This is not a supported Fastidious export.");
  }
  const isV1 = raw.version === 1;
  if (!hasExactKeys(raw, isV1 ? V1_KEYS : V2_KEYS)) {
    return failure("unsupported_import", "This is not a supported Fastidious export.");
  }
  const collectionNames = isV1
    ? ["fasts", "weights"]
    : ["fasts", "weights", "categories", "foods", "meals", "activities", "exercise", "checklistItems", "checklistCompletions", "groceryItems"];
  for (const name of collectionNames) {
    const value = raw[name];
    if (!Array.isArray(value)) return failure("unsupported_import", "This is not a supported Fastidious export.");
    if (value.length > MAX_IMPORT_RECORDS) {
      return failure("too_many_records", `Imports may contain at most ${MAX_IMPORT_RECORDS.toLocaleString()} records per collection.`);
    }
  }
  if (typeof raw.exportedAt !== "string" || !Number.isFinite(Date.parse(raw.exportedAt))) {
    return failure("invalid_export_date", "The export date is invalid.");
  }
  if (!hasExactKeys(raw.preferences, ["timezone", "theme", "weightUnit", "defaultGoalHours"])) {
    return failure("invalid_preferences", "Imported preferences have invalid fields.");
  }
  const preferences = validateLogPreferences(raw.preferences);
  if (!preferences.ok) return preferences;

  const fasts = validateImportedCollection(
    raw.fasts as unknown[],
    ["id", "startAt", "endAt", "goalHours"],
    logId,
    now,
    (value) => validateFastRecord(value, now),
    "fast",
  );
  if (!fasts.ok) return fasts;
  const fastCollection = validateFastCollection(fasts.value);
  if (!fastCollection.ok) return fastCollection;
  const weights = validateImportedCollection(
    raw.weights as unknown[],
    ["id", "measuredAt", "kilograms"],
    logId,
    now,
    (value) => validateWeightRecord(value, now),
    "weight",
  );
  if (!weights.ok) return weights;

  const empty: unknown[] = [];
  const categories = validateImportedCollection(
    isV1 ? empty : raw.categories as unknown[],
    ["id", "kind", "name", "sortOrder"],
    logId,
    now,
    validateCategoryRecord,
    "category",
  );
  if (!categories.ok) return categories;
  const foods = validateImportedCollection(
    isV1 ? empty : raw.foods as unknown[],
    ["id", "name", "serving", "categoryId", "calories", "proteinGrams", "fiberGrams", "priceCents", "externalUrl", "imageAssetId"],
    logId,
    now,
    validateFoodRecord,
    "food",
  );
  if (!foods.ok) return foods;
  const mealImports = isV1 ? empty : (raw.meals as unknown[]).map((value) =>
    isObject(value) && !Object.hasOwn(value, "imageAssetId") ? { ...value, imageAssetId: null } : value,
  );
  const meals = validateImportedCollection(
    mealImports,
    ["id", "eatenAt", "items", "imageAssetId"],
    logId,
    now,
    (value) => validateMealRecord(value, now),
    "meal",
  );
  if (!meals.ok) return meals;
  const activities = validateImportedCollection(
    isV1 ? empty : raw.activities as unknown[],
    ["id", "name", "detail", "categoryId", "externalUrl", "imageAssetId"],
    logId,
    now,
    validateActivityRecord,
    "activity",
  );
  if (!activities.ok) return activities;
  const exercise = validateImportedCollection(
    isV1 ? empty : raw.exercise as unknown[],
    ["id", "activityId", "text", "performedAt"],
    logId,
    now,
    (value) => validateExerciseRecord(value, now),
    "exercise",
  );
  if (!exercise.ok) return exercise;
  const checklistItems = validateImportedCollection(
    isV1 ? empty : raw.checklistItems as unknown[],
    ["id", "name", "cadence", "externalUrl", "imageAssetId", "sortOrder"],
    logId,
    now,
    validateChecklistItemRecord,
    "checklist_item",
  );
  if (!checklistItems.ok) return checklistItems;
  const checklistCompletions = validateImportedCollection(
    isV1 ? empty : raw.checklistCompletions as unknown[],
    ["id", "checklistItemId", "periodKey", "completedAt"],
    logId,
    now,
    (value) => validateChecklistCompletionRecord(value, now),
    "checklist_completion",
  );
  if (!checklistCompletions.ok) return checklistCompletions;
  const groceryItems = validateImportedCollection(
    isV1 ? empty : raw.groceryItems as unknown[],
    ["id", "foodId", "name", "inCart", "externalUrl", "imageAssetId"],
    logId,
    now,
    validateGroceryItemRecord,
    "grocery_item",
  );
  if (!groceryItems.ok) return groceryItems;
  const nutritionTargets = validateNutritionTargets(
    isV1 ? { calories: null, proteinGrams: null, fiberGrams: null } : raw.nutritionTargets,
  );
  if (!nutritionTargets.ok) return nutritionTargets;

  const dates = [
    ...fasts.value.flatMap((fast) => [fast.startAt, fast.endAt ?? now]),
    ...weights.value.map((weight) => weight.measuredAt),
    ...meals.value.map((meal) => meal.eatenAt),
    ...exercise.value.map((entry) => entry.performedAt),
    ...checklistCompletions.value.map((completion) => completion.completedAt),
  ];
  if (dates.length > 0 && Math.max(...dates) - Math.min(...dates) > MAX_IMPORT_RANGE_MS) {
    return failure("date_range_too_large", "Imported records may span at most 100 years.");
  }
  const droppedImageCount = [
    ...foods.value, ...meals.value, ...activities.value, ...checklistItems.value, ...groceryItems.value,
  ].filter((record) => record.imageAssetId !== null).length;
  const snapshot: LocalSnapshot = {
    fasts: fasts.value,
    weights: weights.value,
    categories: categories.value,
    foods: foods.value.map((record) => ({ ...record, imageAssetId: null })),
    meals: meals.value.map((record) => ({ ...record, imageAssetId: null })),
    activities: activities.value.map((record) => ({ ...record, imageAssetId: null })),
    exercise: exercise.value,
    checklistItems: checklistItems.value.map((record) => ({ ...record, imageAssetId: null })),
    checklistCompletions: checklistCompletions.value,
    groceryItems: groceryItems.value.map((record) => ({ ...record, imageAssetId: null })),
    nutritionTargets: nutritionTargets.value,
    preferences: preferences.value,
  };
  const references = validateSnapshotReferences(snapshot);
  if (!references.ok) return references;
  return {
    ok: true,
    value: {
      snapshot,
      fastCount: fasts.value.length,
      weightCount: weights.value.length,
      mealCount: meals.value.length,
      foodCount: foods.value.length,
      activityCount: activities.value.length,
      exerciseCount: exercise.value.length,
      checklistItemCount: checklistItems.value.length,
      checklistCompletionCount: checklistCompletions.value.length,
      groceryItemCount: groceryItems.value.length,
      droppedImageCount,
      firstDate: dates.length > 0 ? Math.min(...dates) : null,
      lastDate: dates.length > 0 ? Math.max(...dates) : null,
      timezone: preferences.value.timezone,
      hasActiveFast: fasts.value.some((fast) => fast.endAt === null),
      preferences: preferences.value,
    },
  };
}

export function validateSnapshotReferences(snapshot: LocalSnapshot): ValidationResult<LocalSnapshot> {
  const collections: Array<readonly { id: string }[]> = [
    snapshot.fasts,
    snapshot.weights,
    snapshot.categories,
    snapshot.foods,
    snapshot.meals,
    snapshot.activities,
    snapshot.exercise,
    snapshot.checklistItems,
    snapshot.checklistCompletions,
    snapshot.groceryItems,
  ];
  if (collections.some((records) => new Set(records.map((record) => record.id)).size !== records.length)) {
    return failure("duplicate_id", "Imported collections cannot contain duplicate record IDs.");
  }
  const categories = new Map(snapshot.categories.map((category) => [category.id, category]));
  if (snapshot.foods.some((food) => food.categoryId !== null && categories.get(food.categoryId)?.kind !== "food")) {
    return failure("invalid_food_category", "An imported food has an invalid category link.");
  }
  if (snapshot.activities.some((activity) => activity.categoryId !== null && categories.get(activity.categoryId)?.kind !== "activity")) {
    return failure("invalid_activity_category", "An imported activity has an invalid category link.");
  }
  const activityIds = new Set(snapshot.activities.map((activity) => activity.id));
  if (snapshot.exercise.some((entry) => entry.activityId !== null && !activityIds.has(entry.activityId))) {
    return failure("invalid_activity_link", "An imported exercise entry has an invalid activity link.");
  }
  const checklistItemIds = new Set(snapshot.checklistItems.map((item) => item.id));
  if (snapshot.checklistCompletions.some((completion) => !checklistItemIds.has(completion.checklistItemId))) {
    return failure("invalid_checklist_link", "An imported checklist completion has an invalid item link.");
  }
  const completionKeys = snapshot.checklistCompletions.map((completion) => `${completion.checklistItemId}:${completion.periodKey}`);
  if (new Set(completionKeys).size !== completionKeys.length) {
    return failure("duplicate_checklist_completion", "Imported checklist completions must be unique per item and period.");
  }
  const foodIds = new Set(snapshot.foods.map((food) => food.id));
  if (snapshot.groceryItems.some((item) => item.foodId !== null && !foodIds.has(item.foodId))) {
    return failure("invalid_food_link", "An imported grocery item has an invalid food link.");
  }
  return { ok: true, value: snapshot };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => actual[index] === key);
}
