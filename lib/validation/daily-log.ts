import type {
  ActivityId,
  ActivityRecord,
  CategoryId,
  CategoryKind,
  CategoryRecord,
  ChecklistCadence,
  ChecklistCompletionId,
  ChecklistCompletionRecord,
  ChecklistItemId,
  ChecklistItemRecord,
  ChecklistPeriodKey,
  EpochMs,
  ExerciseId,
  ExerciseRecord,
  FoodId,
  FoodRecord,
  GroceryItemId,
  GroceryItemRecord,
  ImageAssetId,
  LogId,
  MealId,
  MealItem,
  MealRecord,
  NutritionTargets,
  ValidationResult,
} from "../domain/types";

export const MAX_NAME_LENGTH = 120;
export const MAX_SERVING_LENGTH = 80;
export const MAX_DETAIL_LENGTH = 240;
export const MAX_URL_LENGTH = 2_048;
export const MAX_MEAL_ITEMS = 100;
export const MAX_DAILY_CALORIES = 100_000;
export const MAX_DAILY_NUTRIENT_GRAMS = 10_000;

function error(code: string, message: string, field?: string): ValidationResult<never> {
  return field === undefined ? { ok: false, code, message } : { ok: false, code, message, field };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function optionalEpoch(value: unknown): value is number | null {
  return value === null || isEpoch(value);
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function validateName(value: unknown, field = "name"): ValidationResult<string> {
  if (typeof value !== "string" || value.trim() === "") return error("name_required", "Enter a name.", field);
  if (value.length > MAX_NAME_LENGTH) return error("name_too_long", `Name cannot exceed ${MAX_NAME_LENGTH} characters.`, field);
  return { ok: true, value: value.trim() };
}

function validateExternalUrl(value: unknown): ValidationResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) {
    return error("invalid_external_url", "Link must be a valid HTTP or HTTPS URL.", "externalUrl");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return { ok: true, value: url.toString() };
  } catch {
    return error("invalid_external_url", "Link must be a valid HTTP or HTTPS URL.", "externalUrl");
  }
}

function isImageAssetId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value));
}

function isChecklistPeriodKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const month = /^month:(\d{4})-(\d{2})$/.exec(value);
  if (month) return Number(month[2]) >= 1 && Number(month[2]) <= 12;

  const day = /^(?:day|week):(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!day) return false;
  const year = Number(day[1]);
  const monthIndex = Number(day[2]) - 1;
  const date = Number(day[3]);
  const parsed = new Date(Date.UTC(year, monthIndex, date));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === monthIndex && parsed.getUTCDate() === date;
}

interface RecordMetadata {
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

function validateRecordMetadata(value: Record<string, unknown>): ValidationResult<RecordMetadata> {
  if (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0) {
    return error("invalid_revision", "Revision must be a non-negative integer.", "revision");
  }
  if (!isEpoch(value.updatedAt)) return error("invalid_updated_at", "Updated time must be UTC epoch milliseconds.", "updatedAt");
  if (!optionalEpoch(value.deletedAt)) return error("invalid_deleted_at", "Deleted time must be UTC epoch milliseconds or null.", "deletedAt");
  return {
    ok: true,
    value: {
      revision: value.revision,
      updatedAt: value.updatedAt as EpochMs,
      deletedAt: value.deletedAt as EpochMs | null,
    },
  };
}

function validateMealItem(value: unknown): ValidationResult<MealItem> {
  if (!isObject(value)) return error("meal_item_not_object", "Meal item must be an object.");
  if (value.foodId !== null && !isUuid(value.foodId)) {
    return error("invalid_food_id", "Food id must be a UUID or null.", "foodId");
  }
  const name = validateName(value.name);
  if (!name.ok) return name;
  if (
    typeof value.quantity !== "number" ||
    !Number.isFinite(value.quantity) ||
    value.quantity <= 0 ||
    !Number.isInteger(value.quantity * 2)
  ) {
    return error("invalid_meal_quantity", "Quantity must be positive and use half-unit steps.", "quantity");
  }
  if (
    typeof value.caloriesPerServing !== "number" ||
    !Number.isFinite(value.caloriesPerServing) ||
    value.caloriesPerServing < 0
  ) {
    return error("invalid_calories", "Calories must be a non-negative finite number.", "caloriesPerServing");
  }
  if (!isNullableNonNegativeNumber(value.proteinGramsPerServing)) {
    return error("invalid_protein", "Protein must be a non-negative finite number or null.", "proteinGramsPerServing");
  }
  if (!isNullableNonNegativeNumber(value.fiberGramsPerServing)) {
    return error("invalid_fiber", "Fiber must be a non-negative finite number or null.", "fiberGramsPerServing");
  }
  return {
    ok: true,
    value: {
      foodId: value.foodId as FoodId | null,
      name: name.value,
      quantity: value.quantity,
      caloriesPerServing: value.caloriesPerServing,
      proteinGramsPerServing: value.proteinGramsPerServing,
      fiberGramsPerServing: value.fiberGramsPerServing,
    },
  };
}

export function validateCategoryRecord(value: unknown): ValidationResult<CategoryRecord> {
  if (!isObject(value)) return error("category_not_object", "Category must be an object.");
  if (!isUuid(value.id)) return error("invalid_category_id", "Category id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  if (value.kind !== "food" && value.kind !== "activity") {
    return error("invalid_category_kind", "Category kind must be food or activity.", "kind");
  }
  const name = validateName(value.name);
  if (!name.ok) return name;
  if (typeof value.sortOrder !== "number" || !Number.isInteger(value.sortOrder) || value.sortOrder < 0) {
    return error("invalid_sort_order", "Sort order must be a non-negative integer.", "sortOrder");
  }
  const metadata = validateRecordMetadata(value);
  if (!metadata.ok) return metadata;
  return {
    ok: true,
    value: {
      id: value.id as CategoryId,
      logId: value.logId as LogId,
      kind: value.kind as CategoryKind,
      name: name.value,
      sortOrder: value.sortOrder,
      ...metadata.value,
    },
  };
}

export function validateActivityRecord(value: unknown): ValidationResult<ActivityRecord> {
  if (!isObject(value)) return error("activity_not_object", "Activity must be an object.");
  if (!isUuid(value.id)) return error("invalid_activity_id", "Activity id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  const name = validateName(value.name);
  if (!name.ok) return name;
  if (typeof value.detail !== "string" || value.detail.length > MAX_DETAIL_LENGTH) {
    return error("invalid_activity_detail", `Activity detail cannot exceed ${MAX_DETAIL_LENGTH} characters.`, "detail");
  }
  if (value.categoryId !== null && !isUuid(value.categoryId)) {
    return error("invalid_category_id", "Category id must be a UUID or null.", "categoryId");
  }
  const url = validateExternalUrl(value.externalUrl);
  if (!url.ok) return url;
  if (!isImageAssetId(value.imageAssetId)) {
    return error("invalid_image_asset_id", "Image asset reference is invalid.", "imageAssetId");
  }
  const metadata = validateRecordMetadata(value);
  if (!metadata.ok) return metadata;
  return {
    ok: true,
    value: {
      id: value.id as ActivityId,
      logId: value.logId as LogId,
      name: name.value,
      detail: value.detail.trim(),
      categoryId: value.categoryId as CategoryId | null,
      externalUrl: url.value,
      imageAssetId: value.imageAssetId as ImageAssetId | null,
      ...metadata.value,
    },
  };
}

export function validateExerciseRecord(value: unknown, now = Date.now()): ValidationResult<ExerciseRecord> {
  if (!isObject(value)) return error("exercise_not_object", "Exercise entry must be an object.");
  if (!isUuid(value.id)) return error("invalid_exercise_id", "Exercise id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  if (value.activityId !== null && !isUuid(value.activityId)) {
    return error("invalid_activity_id", "Activity id must be a UUID or null.", "activityId");
  }
  const text = validateName(value.text, "text");
  if (!text.ok) return text;
  if (!isEpoch(value.performedAt)) return error("invalid_performed_at", "Exercise time must be UTC epoch milliseconds.", "performedAt");
  if (value.performedAt > now) return error("exercise_time_in_future", "Exercise time cannot be in the future.", "performedAt");
  const metadata = validateRecordMetadata(value);
  if (!metadata.ok) return metadata;
  return {
    ok: true,
    value: {
      id: value.id as ExerciseId,
      logId: value.logId as LogId,
      activityId: value.activityId as ActivityId | null,
      text: text.value,
      performedAt: value.performedAt as EpochMs,
      ...metadata.value,
    },
  };
}

export function validateChecklistCompletionRecord(value: unknown, now = Date.now()): ValidationResult<ChecklistCompletionRecord> {
  if (!isObject(value)) return error("checklist_completion_not_object", "Checklist completion must be an object.");
  if (!isUuid(value.id)) return error("invalid_checklist_completion_id", "Checklist completion id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  if (!isUuid(value.checklistItemId)) {
    return error("invalid_checklist_item_id", "Checklist item id must be a UUID.", "checklistItemId");
  }
  if (!isChecklistPeriodKey(value.periodKey)) {
    return error("invalid_checklist_period", "Checklist period is invalid.", "periodKey");
  }
  if (!isEpoch(value.completedAt)) return error("invalid_completed_at", "Completion time must be UTC epoch milliseconds.", "completedAt");
  if (value.completedAt > now) return error("completion_time_in_future", "Completion time cannot be in the future.", "completedAt");
  const metadata = validateRecordMetadata(value);
  if (!metadata.ok) return metadata;
  return {
    ok: true,
    value: {
      id: value.id as ChecklistCompletionId,
      logId: value.logId as LogId,
      checklistItemId: value.checklistItemId as ChecklistItemId,
      periodKey: value.periodKey as ChecklistPeriodKey,
      completedAt: value.completedAt as EpochMs,
      ...metadata.value,
    },
  };
}

export function validateGroceryItemRecord(value: unknown): ValidationResult<GroceryItemRecord> {
  if (!isObject(value)) return error("grocery_item_not_object", "Grocery item must be an object.");
  if (!isUuid(value.id)) return error("invalid_grocery_item_id", "Grocery item id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  if (value.foodId !== null && !isUuid(value.foodId)) {
    return error("invalid_food_id", "Food id must be a UUID or null.", "foodId");
  }
  const name = validateName(value.name);
  if (!name.ok) return name;
  if (typeof value.inCart !== "boolean") return error("invalid_cart_state", "Cart state must be boolean.", "inCart");
  const url = validateExternalUrl(value.externalUrl);
  if (!url.ok) return url;
  if (!isImageAssetId(value.imageAssetId)) {
    return error("invalid_image_asset_id", "Image asset reference is invalid.", "imageAssetId");
  }
  const metadata = validateRecordMetadata(value);
  if (!metadata.ok) return metadata;
  return {
    ok: true,
    value: {
      id: value.id as GroceryItemId,
      logId: value.logId as LogId,
      foodId: value.foodId as FoodId | null,
      name: name.value,
      inCart: value.inCart,
      externalUrl: url.value,
      imageAssetId: value.imageAssetId as ImageAssetId | null,
      ...metadata.value,
    },
  };
}

export function validateNutritionTargets(value: unknown): ValidationResult<NutritionTargets> {
  if (!isObject(value)) return error("nutrition_targets_not_object", "Nutrition targets must be an object.");
  const fields = [
    ["calories", MAX_DAILY_CALORIES],
    ["proteinGrams", MAX_DAILY_NUTRIENT_GRAMS],
    ["fiberGrams", MAX_DAILY_NUTRIENT_GRAMS],
  ] as const;
  for (const [field, maximum] of fields) {
    const target = value[field];
    if (target !== null && (
      typeof target !== "number" || !Number.isFinite(target) || target <= 0 || target > maximum
    )) {
      return error("invalid_nutrition_target", `${field} must be null or a positive number no greater than ${maximum}.`, field);
    }
  }
  return {
    ok: true,
    value: {
      calories: value.calories as number | null,
      proteinGrams: value.proteinGrams as number | null,
      fiberGrams: value.fiberGrams as number | null,
    },
  };
}

export function validateChecklistItemRecord(value: unknown): ValidationResult<ChecklistItemRecord> {
  if (!isObject(value)) return error("checklist_item_not_object", "Checklist item must be an object.");
  if (!isUuid(value.id)) return error("invalid_checklist_item_id", "Checklist item id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  const name = validateName(value.name);
  if (!name.ok) return name;
  if (value.cadence !== "daily" && value.cadence !== "weekly" && value.cadence !== "monthly") {
    return error("invalid_checklist_cadence", "Cadence must be daily, weekly, or monthly.", "cadence");
  }
  const url = validateExternalUrl(value.externalUrl);
  if (!url.ok) return url;
  if (!isImageAssetId(value.imageAssetId)) {
    return error("invalid_image_asset_id", "Image asset reference is invalid.", "imageAssetId");
  }
  if (typeof value.sortOrder !== "number" || !Number.isInteger(value.sortOrder) || value.sortOrder < 0) {
    return error("invalid_sort_order", "Sort order must be a non-negative integer.", "sortOrder");
  }
  if (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0) {
    return error("invalid_revision", "Revision must be a non-negative integer.", "revision");
  }
  if (!isEpoch(value.updatedAt)) return error("invalid_updated_at", "Updated time must be UTC epoch milliseconds.", "updatedAt");
  if (!optionalEpoch(value.deletedAt)) return error("invalid_deleted_at", "Deleted time must be UTC epoch milliseconds or null.", "deletedAt");
  return {
    ok: true,
    value: {
      id: value.id as ChecklistItemId,
      logId: value.logId as LogId,
      name: name.value,
      cadence: value.cadence as ChecklistCadence,
      externalUrl: url.value,
      imageAssetId: value.imageAssetId as ImageAssetId | null,
      sortOrder: value.sortOrder,
      revision: value.revision,
      updatedAt: value.updatedAt as EpochMs,
      deletedAt: value.deletedAt as EpochMs | null,
    },
  };
}

export function validateMealRecord(value: unknown, now = Date.now()): ValidationResult<MealRecord> {
  if (!isObject(value)) return error("meal_not_object", "Meal must be an object.");
  if (!isUuid(value.id)) return error("invalid_meal_id", "Meal id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  if (!isEpoch(value.eatenAt)) return error("invalid_eaten_at", "Meal time must be UTC epoch milliseconds.", "eatenAt");
  if (value.eatenAt > now) return error("meal_time_in_future", "Meal time cannot be in the future.", "eatenAt");
  if (!Array.isArray(value.items) || value.items.length === 0) {
    return error("meal_empty", "Meal must contain at least one item.", "items");
  }
  if (value.items.length > MAX_MEAL_ITEMS) {
    return error("too_many_meal_items", `Meal cannot contain more than ${MAX_MEAL_ITEMS} items.`, "items");
  }
  if (!isImageAssetId(value.imageAssetId)) {
    return error("invalid_image_asset_id", "Image asset reference is invalid.", "imageAssetId");
  }
  const items: MealItem[] = [];
  for (const item of value.items) {
    const result = validateMealItem(item);
    if (!result.ok) return result;
    items.push(result.value);
  }
  if (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0) {
    return error("invalid_revision", "Revision must be a non-negative integer.", "revision");
  }
  if (!isEpoch(value.updatedAt)) return error("invalid_updated_at", "Updated time must be UTC epoch milliseconds.", "updatedAt");
  if (!optionalEpoch(value.deletedAt)) return error("invalid_deleted_at", "Deleted time must be UTC epoch milliseconds or null.", "deletedAt");
  return {
    ok: true,
    value: {
      id: value.id as MealId,
      logId: value.logId as LogId,
      eatenAt: value.eatenAt as EpochMs,
      items,
      imageAssetId: value.imageAssetId as ImageAssetId | null,
      revision: value.revision,
      updatedAt: value.updatedAt as EpochMs,
      deletedAt: value.deletedAt as EpochMs | null,
    },
  };
}

export function validateFoodRecord(value: unknown): ValidationResult<FoodRecord> {
  if (!isObject(value)) return error("food_not_object", "Food must be an object.");
  if (!isUuid(value.id)) return error("invalid_food_id", "Food id must be a UUID.", "id");
  if (!isUuid(value.logId)) return error("invalid_log_id", "Log id must be a UUID.", "logId");
  const name = validateName(value.name);
  if (!name.ok) return name;
  if (typeof value.serving !== "string" || value.serving.length > MAX_SERVING_LENGTH) {
    return error("invalid_serving", `Serving cannot exceed ${MAX_SERVING_LENGTH} characters.`, "serving");
  }
  if (value.categoryId !== null && !isUuid(value.categoryId)) {
    return error("invalid_category_id", "Category id must be a UUID or null.", "categoryId");
  }
  if (typeof value.calories !== "number" || !Number.isFinite(value.calories) || value.calories < 0) {
    return error("invalid_calories", "Calories must be a non-negative finite number.", "calories");
  }
  if (!isNullableNonNegativeNumber(value.proteinGrams)) {
    return error("invalid_protein", "Protein must be a non-negative finite number or null.", "proteinGrams");
  }
  if (!isNullableNonNegativeNumber(value.fiberGrams)) {
    return error("invalid_fiber", "Fiber must be a non-negative finite number or null.", "fiberGrams");
  }
  if (value.priceCents !== null && (
    typeof value.priceCents !== "number" || !Number.isSafeInteger(value.priceCents) || value.priceCents < 0
  )) {
    return error("invalid_price", "Price must be non-negative whole cents or null.", "priceCents");
  }
  const url = validateExternalUrl(value.externalUrl);
  if (!url.ok) return url;
  if (!isImageAssetId(value.imageAssetId)) {
    return error("invalid_image_asset_id", "Image asset reference is invalid.", "imageAssetId");
  }
  if (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0) {
    return error("invalid_revision", "Revision must be a non-negative integer.", "revision");
  }
  if (!isEpoch(value.updatedAt)) return error("invalid_updated_at", "Updated time must be UTC epoch milliseconds.", "updatedAt");
  if (!optionalEpoch(value.deletedAt)) return error("invalid_deleted_at", "Deleted time must be UTC epoch milliseconds or null.", "deletedAt");

  return {
    ok: true,
    value: {
      id: value.id as FoodId,
      logId: value.logId as LogId,
      name: name.value,
      serving: value.serving.trim(),
      categoryId: value.categoryId as CategoryId | null,
      calories: value.calories,
      proteinGrams: value.proteinGrams,
      fiberGrams: value.fiberGrams,
      priceCents: value.priceCents,
      externalUrl: url.value,
      imageAssetId: value.imageAssetId as ImageAssetId | null,
      revision: value.revision,
      updatedAt: value.updatedAt as EpochMs,
      deletedAt: value.deletedAt as EpochMs | null,
    },
  };
}
