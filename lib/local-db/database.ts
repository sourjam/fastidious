import Dexie, { type EntityTable } from "dexie";

import type {
  ActivityRecord,
  CategoryRecord,
  ChecklistCompletionRecord,
  ChecklistItemRecord,
  ExerciseRecord,
  FastRecord,
  FoodRecord,
  GroceryItemRecord,
  MealRecord,
  WeightRecord,
} from "../domain/types";
import {
  LOCAL_DATABASE_VERSION,
  META_KEY,
  type LocalMeta,
  type LocalMutation,
  type PendingImage,
  type PreImportBackup,
  type StoredNutritionTargets,
  type StoredPreferences,
} from "./schema";

export const DEFAULT_LOCAL_DATABASE_NAME = "fastidious";
export const DATABASE_CONTROL_CHANNEL = "fastidious-database-control";
export const DATABASE_CLOSE_MESSAGE = "close-for-reset";

function randomUuid(): string {
  return crypto.randomUUID();
}

export class FastidiousDatabase extends Dexie {
  meta!: EntityTable<LocalMeta, "key">;
  fasts!: EntityTable<FastRecord, "id">;
  weights!: EntityTable<WeightRecord, "id">;
  categories!: EntityTable<CategoryRecord, "id">;
  foods!: EntityTable<FoodRecord, "id">;
  meals!: EntityTable<MealRecord, "id">;
  activities!: EntityTable<ActivityRecord, "id">;
  exercise!: EntityTable<ExerciseRecord, "id">;
  checklistItems!: EntityTable<ChecklistItemRecord, "id">;
  checklistCompletions!: EntityTable<ChecklistCompletionRecord, "id">;
  groceryItems!: EntityTable<GroceryItemRecord, "id">;
  nutritionTargets!: EntityTable<StoredNutritionTargets, "key">;
  preferences!: EntityTable<StoredPreferences, "key">;
  mutations!: EntityTable<LocalMutation, "mutationId">;
  pendingImages!: EntityTable<PendingImage, "id">;
  preImportBackup!: EntityTable<PreImportBackup, "key">;

  private controlChannel: BroadcastChannel | null = null;

  constructor(name = DEFAULT_LOCAL_DATABASE_NAME) {
    super(name);
    const versionOneStores = {
      meta: "&key, logId, deviceId",
      fasts: "&id, logId, startAt, endAt, revision, deletedAt",
      weights: "&id, logId, measuredAt, revision, deletedAt",
      preferences: "&key",
      mutations: "&mutationId, &sequence, status, [status+sequence], [entityType+entityId], dataGeneration",
      preImportBackup: "&key",
    };
    this.version(1).stores(versionOneStores);
    const versionTwoStores = {
      ...versionOneStores,
      categories: "&id, logId, [kind+sortOrder], revision, deletedAt",
      foods: "&id, logId, categoryId, name, revision, deletedAt",
      meals: "&id, logId, eatenAt, revision, deletedAt",
      activities: "&id, logId, categoryId, name, revision, deletedAt",
      exercise: "&id, logId, activityId, performedAt, revision, deletedAt",
      checklistItems: "&id, logId, cadence, sortOrder, revision, deletedAt",
      checklistCompletions: "&id, logId, checklistItemId, periodKey, [checklistItemId+periodKey], completedAt, revision, deletedAt",
      groceryItems: "&id, logId, foodId, inCart, revision, deletedAt",
      nutritionTargets: "&key",
    };
    this.version(2).stores(versionTwoStores).upgrade(async (transaction) => {
      await transaction.table("preImportBackup").toCollection().modify((backup) => {
        Object.assign(backup, {
          categories: [],
          foods: [],
          meals: [],
          activities: [],
          exercise: [],
          checklistItems: [],
          checklistCompletions: [],
          groceryItems: [],
          nutritionTargets: { calories: null, proteinGrams: null, fiberGrams: null },
        });
      });
    });
    this.version(LOCAL_DATABASE_VERSION).stores({
      ...versionTwoStores,
      pendingImages: "&id, logId, [entityType+entityId], status, updatedAt",
    });

    this.on("ready", async () => {
      await this.transaction("rw", this.meta, this.mutations, async () => {
        let meta = await this.meta.get(META_KEY);
        if (!meta) {
          meta = {
            key: META_KEY,
            deviceId: randomUuid() as LocalMeta["deviceId"],
            logId: null,
            cursor: 0,
            serverGeneration: 0,
            dataGeneration: 0,
            credentialGeneration: 0,
            nextMutationSequence: 1,
            schemaState: "ready",
            syncError: null,
            syncErrorCount: 0,
          };
          await this.meta.add(meta);
        } else if (!Number.isInteger(meta.syncErrorCount)) {
          await this.meta.update(META_KEY, { syncErrorCount: 0 });
        }
        await this.mutations.where("status").equals("sending").modify({ status: "pending" });
      });
    });

    if (typeof BroadcastChannel !== "undefined") {
      this.controlChannel = new BroadcastChannel(DATABASE_CONTROL_CHANNEL);
      this.controlChannel.addEventListener("message", (event) => {
        if (event.data === DATABASE_CLOSE_MESSAGE) this.close();
      });
    }
  }

  override close(): void {
    this.controlChannel?.close();
    this.controlChannel = null;
    super.close();
  }
}

export async function openLocalDatabase(name = DEFAULT_LOCAL_DATABASE_NAME): Promise<FastidiousDatabase> {
  const database = new FastidiousDatabase(name);
  await database.open();
  return database;
}
