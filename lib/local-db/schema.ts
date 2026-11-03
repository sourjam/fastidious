import type {
  ActivityId,
  ActivityRecord,
  CategoryId,
  CategoryRecord,
  ChecklistCompletionId,
  ChecklistCompletionRecord,
  ChecklistItemId,
  ChecklistItemRecord,
  DeviceId,
  ExerciseId,
  ExerciseRecord,
  FastId,
  FoodId,
  FoodRecord,
  GroceryItemId,
  GroceryItemRecord,
  FastRecord,
  LogId,
  LogPreferences,
  MealId,
  MealRecord,
  MutationId,
  NutritionTargets,
  WeightId,
  WeightRecord,
} from "../domain/types";

export const LOCAL_DATABASE_VERSION = 3;
export const META_KEY = "state";
export const PREFERENCES_KEY = "active";
export const BACKUP_KEY = "pre-import";

export interface LocalMeta {
  key: typeof META_KEY;
  deviceId: DeviceId;
  logId: LogId | null;
  cursor: number;
  serverGeneration: number;
  dataGeneration: number;
  credentialGeneration: number;
  nextMutationSequence: number;
  schemaState: "ready";
  syncError: string | null;
  syncErrorCount: number;
}

export interface StoredPreferences extends LogPreferences {
  key: typeof PREFERENCES_KEY;
}

export interface StoredNutritionTargets extends NutritionTargets {
  key: typeof PREFERENCES_KEY;
}

export type ImageEntity = "food" | "meal" | "activity" | "checklistItem" | "groceryItem";
export type PendingImageStatus = "pending" | "uploading" | "failed";

export interface PendingImage {
  id: string;
  logId: LogId;
  entityType: ImageEntity;
  entityId: string;
  blob: Blob;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  status: PendingImageStatus;
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export type MutationStatus = "pending" | "sending" | "quarantined";
export type DailyLogEntity =
  | "category"
  | "food"
  | "meal"
  | "activity"
  | "exercise"
  | "checklistItem"
  | "checklistCompletion"
  | "groceryItem";
export type MutationEntity = "fast" | "weight" | "preferences" | "nutritionTargets" | DailyLogEntity | "log";

export interface LocalMutation {
  mutationId: MutationId;
  deviceId: DeviceId;
  sequence: number;
  status: MutationStatus;
  entityType: MutationEntity;
  entityId: string;
  operation: string;
  payload: unknown;
  dataGeneration: number;
  createdAt: number;
}

export interface LocalSnapshot {
  fasts: FastRecord[];
  weights: WeightRecord[];
  categories: CategoryRecord[];
  foods: FoodRecord[];
  meals: MealRecord[];
  activities: ActivityRecord[];
  exercise: ExerciseRecord[];
  checklistItems: ChecklistItemRecord[];
  checklistCompletions: ChecklistCompletionRecord[];
  groceryItems: GroceryItemRecord[];
  nutritionTargets: NutritionTargets;
  preferences: LogPreferences;
}

export type DailyLogSnapshot = Omit<LocalSnapshot, "fasts" | "weights" | "preferences">;

export function emptyDailyLogSnapshot(): DailyLogSnapshot {
  return {
    categories: [],
    foods: [],
    meals: [],
    activities: [],
    exercise: [],
    checklistItems: [],
    checklistCompletions: [],
    groceryItems: [],
    nutritionTargets: { calories: null, proteinGrams: null, fiberGrams: null },
  };
}

export interface PreImportBackup extends LocalSnapshot {
  key: typeof BACKUP_KEY;
  createdAt: number;
  dataGeneration: number;
}

export interface ServerSnapshot extends LocalSnapshot {
  logId: LogId;
  cursor: number;
  serverGeneration: number;
  dataGeneration: number;
  credentialGeneration: number;
}

export type ServerChange =
  | { revision: number; entityType: "fast"; entityId: FastId; record: FastRecord | null }
  | { revision: number; entityType: "weight"; entityId: WeightId; record: WeightRecord | null }
  | {
      revision: number;
      entityType: "category";
      entityId: CategoryId;
      record: CategoryRecord | null;
      replacementCategoryId?: CategoryId;
    }
  | { revision: number; entityType: "food"; entityId: FoodId; record: FoodRecord | null }
  | { revision: number; entityType: "meal"; entityId: MealId; record: MealRecord | null }
  | { revision: number; entityType: "activity"; entityId: ActivityId; record: ActivityRecord | null }
  | { revision: number; entityType: "exercise"; entityId: ExerciseId; record: ExerciseRecord | null }
  | { revision: number; entityType: "checklistItem"; entityId: ChecklistItemId; record: ChecklistItemRecord | null }
  | { revision: number; entityType: "checklistCompletion"; entityId: ChecklistCompletionId; record: ChecklistCompletionRecord | null }
  | { revision: number; entityType: "groceryItem"; entityId: GroceryItemId; record: GroceryItemRecord | null }
  | { revision: number; entityType: "nutritionTargets"; entityId: typeof PREFERENCES_KEY; record: NutritionTargets }
  | { revision: number; entityType: "preferences"; entityId: typeof PREFERENCES_KEY; record: LogPreferences };
