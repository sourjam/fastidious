export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type LogId = Brand<string, "LogId">;
export type FastId = Brand<string, "FastId">;
export type WeightId = Brand<string, "WeightId">;
export type CategoryId = Brand<string, "CategoryId">;
export type FoodId = Brand<string, "FoodId">;
export type MealId = Brand<string, "MealId">;
export type ActivityId = Brand<string, "ActivityId">;
export type ExerciseId = Brand<string, "ExerciseId">;
export type ChecklistItemId = Brand<string, "ChecklistItemId">;
export type ChecklistCompletionId = Brand<string, "ChecklistCompletionId">;
export type GroceryItemId = Brand<string, "GroceryItemId">;
export type ImageAssetId = Brand<string, "ImageAssetId">;
export type DeviceId = Brand<string, "DeviceId">;
export type MutationId = Brand<string, "MutationId">;
export type EpochMs = Brand<number, "EpochMs">;
export type IanaTimezone = Brand<string, "IanaTimezone">;

export type ThemePreference = "system" | "light" | "dark";
export type WeightUnit = "kg" | "lb";
export type CategoryKind = "food" | "activity";
export type ChecklistCadence = "daily" | "weekly" | "monthly";
export type ChecklistPeriodKey = Brand<string, "ChecklistPeriodKey">;

export interface FastRecord {
  id: FastId;
  logId: LogId;
  startAt: EpochMs;
  endAt: EpochMs | null;
  goalHours: number;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface WeightRecord {
  id: WeightId;
  logId: LogId;
  measuredAt: EpochMs;
  kilograms: number;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface CategoryRecord {
  id: CategoryId;
  logId: LogId;
  kind: CategoryKind;
  name: string;
  sortOrder: number;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface FoodRecord {
  id: FoodId;
  logId: LogId;
  name: string;
  serving: string;
  categoryId: CategoryId | null;
  calories: number;
  proteinGrams: number | null;
  fiberGrams: number | null;
  priceCents: number | null;
  externalUrl: string | null;
  imageAssetId: ImageAssetId | null;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface MealItem {
  foodId: FoodId | null;
  name: string;
  quantity: number;
  caloriesPerServing: number;
  proteinGramsPerServing: number | null;
  fiberGramsPerServing: number | null;
}

export interface MealRecord {
  id: MealId;
  logId: LogId;
  eatenAt: EpochMs;
  items: MealItem[];
  imageAssetId: ImageAssetId | null;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface ActivityRecord {
  id: ActivityId;
  logId: LogId;
  name: string;
  detail: string;
  categoryId: CategoryId | null;
  externalUrl: string | null;
  imageAssetId: ImageAssetId | null;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface ExerciseRecord {
  id: ExerciseId;
  logId: LogId;
  activityId: ActivityId | null;
  text: string;
  performedAt: EpochMs;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface GroceryItemRecord {
  id: GroceryItemId;
  logId: LogId;
  foodId: FoodId | null;
  name: string;
  inCart: boolean;
  externalUrl: string | null;
  imageAssetId: ImageAssetId | null;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface ChecklistItemRecord {
  id: ChecklistItemId;
  logId: LogId;
  name: string;
  cadence: ChecklistCadence;
  externalUrl: string | null;
  imageAssetId: ImageAssetId | null;
  sortOrder: number;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface ChecklistCompletionRecord {
  id: ChecklistCompletionId;
  logId: LogId;
  checklistItemId: ChecklistItemId;
  periodKey: ChecklistPeriodKey;
  completedAt: EpochMs;
  revision: number;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface NutritionTargets {
  calories: number | null;
  proteinGrams: number | null;
  fiberGrams: number | null;
}

export interface LogPreferences {
  timezone: IanaTimezone;
  theme: ThemePreference;
  weightUnit: WeightUnit;
  defaultGoalHours: number;
}

export interface FastPreset {
  hours: number;
  label: string;
  subtitle: string;
}

export interface FastingStage {
  thresholdHours: number;
  name: string;
  shortName: string;
  description: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; field?: string };

export const epochMs = (value: number): EpochMs => value as EpochMs;
