import type { Table } from "dexie";

import type {
  ActivityRecord,
  CategoryId,
  CategoryRecord,
  ChecklistCompletionId,
  ChecklistCompletionRecord,
  ChecklistItemId,
  ChecklistItemRecord,
  EpochMs,
  ExerciseRecord,
  FastId,
  FastRecord,
  FoodRecord,
  GroceryItemRecord,
  LogPreferences,
  MealRecord,
  MutationId,
  NutritionTargets,
  ValidationResult,
  WeightId,
  WeightRecord,
} from "../domain/types";
import {
  createFastRecord,
  createWeightRecord,
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
import { checklistPeriodKey } from "../domain/checklist";
import { validateSnapshotReferences } from "../settings/data";
import type { FastidiousDatabase } from "./database";
import {
  BACKUP_KEY,
  META_KEY,
  PREFERENCES_KEY,
  type LocalMeta,
  type LocalMutation,
  type DailyLogEntity,
  type LocalSnapshot,
  type ImageEntity,
  type MutationEntity,
  type PendingImage,
  type StoredNutritionTargets,
  type StoredPreferences,
} from "./schema";

export type LocalOperationResult<T> = ValidationResult<{ value: T; mutation: LocalMutation }>;

type LocalFailure = Extract<ValidationResult<never>, { ok: false }>;

function failure(code: string, message: string, field?: string): LocalFailure {
  return field === undefined ? { ok: false, code, message } : { ok: false, code, message, field };
}

function mutationId(): MutationId {
  return crypto.randomUUID() as MutationId;
}

async function state(db: FastidiousDatabase): Promise<LocalMeta | LocalFailure> {
  const meta = await db.meta.get(META_KEY);
  if (!meta?.logId) return failure("no_active_log", "No active log is installed on this device.");
  return meta;
}

async function appendMutation(
  db: FastidiousDatabase,
  meta: LocalMeta,
  id: MutationId,
  entityType: MutationEntity,
  entityId: string,
  operation: string,
  payload: unknown,
  createdAt: number,
): Promise<LocalMutation> {
  const current = await db.meta.get(META_KEY);
  if (
    !current?.logId ||
    current.logId !== meta.logId ||
    current.dataGeneration !== meta.dataGeneration ||
    current.deviceId !== meta.deviceId
  ) {
    throw new Error("Active local log changed while applying an operation.");
  }
  const mutation: LocalMutation = {
    mutationId: id,
    deviceId: current.deviceId,
    sequence: current.nextMutationSequence,
    status: "pending",
    entityType,
    entityId,
    operation,
    payload,
    dataGeneration: current.dataGeneration,
    createdAt,
  };
  await db.mutations.add(mutation);
  await db.meta.update(META_KEY, {
    nextMutationSequence: current.nextMutationSequence + 1,
    syncError: null,
    syncErrorCount: 0,
  });
  return mutation;
}

async function currentFasts(db: FastidiousDatabase): Promise<FastRecord[]> {
  return db.fasts.toArray();
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

function dailyLogTable(db: FastidiousDatabase, entity: DailyLogEntity): Table<DailyLogRecord, string> {
  const table = {
    category: db.categories,
    food: db.foods,
    meal: db.meals,
    activity: db.activities,
    exercise: db.exercise,
    checklistItem: db.checklistItems,
    checklistCompletion: db.checklistCompletions,
    groceryItem: db.groceryItems,
  }[entity];
  return table as unknown as Table<DailyLogRecord, string>;
}

function validateDailyLogRecord(
  entity: DailyLogEntity,
  value: unknown,
  now: number,
): ValidationResult<DailyLogRecord> {
  switch (entity) {
    case "category": return validateCategoryRecord(value);
    case "food": return validateFoodRecord(value);
    case "meal": return validateMealRecord(value, now);
    case "activity": return validateActivityRecord(value);
    case "exercise": return validateExerciseRecord(value, now);
    case "checklistItem": return validateChecklistItemRecord(value);
    case "checklistCompletion": return validateChecklistCompletionRecord(value, now);
    case "groceryItem": return validateGroceryItemRecord(value);
  }
}

export async function saveDailyLogRecord(
  db: FastidiousDatabase,
  entity: DailyLogEntity,
  record: DailyLogRecord,
  now: EpochMs,
): Promise<LocalOperationResult<DailyLogRecord>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const checked = validateDailyLogRecord(entity, record, now);
  if (!checked.ok) return checked;
  if (checked.value.logId !== meta.logId) return failure("wrong_log", "Record belongs to a different log.");
  const table = dailyLogTable(db, entity);
  return db.transaction("rw", db.meta, table, db.mutations, async () => {
    await table.put(checked.value);
    const mutation = await appendMutation(db, meta, queuedId, entity, checked.value.id, "upsert", checked.value, now);
    return { ok: true, value: { value: checked.value, mutation } };
  });
}

export async function saveRecordWithPendingImage(
  db: FastidiousDatabase,
  entity: ImageEntity,
  record: Extract<DailyLogRecord, { imageAssetId: unknown }>,
  image: Pick<PendingImage, "blob" | "mimeType" | "width" | "height">,
  now: EpochMs,
): Promise<ValidationResult<{ value: DailyLogRecord; mutation: LocalMutation; pending: PendingImage }>> {
  if (image.blob.size > 5 * 1024 * 1024 || image.blob.size <= 0 || !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)) {
    return failure("invalid_image", "Choose a JPEG, PNG, or WebP image no larger than 5 MB.");
  }
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.width * image.height > 16_000_000) {
    return failure("invalid_image_dimensions", "Images may contain at most 16 megapixels.");
  }
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const checked = validateDailyLogRecord(entity, record, now);
  if (!checked.ok) return checked;
  if (checked.value.logId !== meta.logId) return failure("wrong_log", "Record belongs to a different log.");
  const table = dailyLogTable(db, entity);
  const pending: PendingImage = {
    id: crypto.randomUUID(),
    logId: meta.logId,
    entityType: entity,
    entityId: checked.value.id,
    blob: image.blob,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    status: "pending",
    attempts: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  return db.transaction("rw", [db.meta, table, db.mutations, db.pendingImages], async () => {
    await table.put(checked.value);
    const mutation = await appendMutation(db, meta, mutationId(), entity, checked.value.id, "upsert", checked.value, now);
    const old = await db.pendingImages.where("[entityType+entityId]").equals([entity, checked.value.id]).toArray();
    await db.pendingImages.bulkDelete(old.map((item) => item.id));
    await db.pendingImages.put(pending);
    return { ok: true as const, value: { value: checked.value, mutation, pending } };
  });
}

export async function discardPendingImages(db: FastidiousDatabase, entity: ImageEntity, entityId: string): Promise<void> {
  const pending = await db.pendingImages.where("[entityType+entityId]").equals([entity, entityId]).toArray();
  await db.pendingImages.bulkDelete(pending.map((item) => item.id));
}

export async function attachUploadedImage(
  db: FastidiousDatabase,
  pendingId: string,
  assetId: string,
  now: EpochMs,
): Promise<ValidationResult<{ value: DailyLogRecord; mutation: LocalMutation }>> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(assetId)) return failure("invalid_image_asset", "Uploaded image reference is invalid.");
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const pending = await db.pendingImages.get(pendingId);
  if (!pending || pending.logId !== meta.logId) return failure("pending_image_not_found", "Pending image was not found.");
  const table = dailyLogTable(db, pending.entityType);
  const current = await table.get(pending.entityId);
  if (!current || current.logId !== meta.logId || current.deletedAt !== null || !("imageAssetId" in current)) return failure("record_not_found", "Image record was not found.");
  const updated = { ...current, imageAssetId: assetId, updatedAt: now } as DailyLogRecord;
  return db.transaction("rw", [db.meta, table, db.mutations, db.pendingImages], async () => {
    await table.put(updated);
    const mutation = await appendMutation(db, meta, mutationId(), pending.entityType, updated.id, "upsert", updated, now);
    await db.pendingImages.delete(pending.id);
    return { ok: true as const, value: { value: updated, mutation } };
  });
}

export async function deleteDailyLogRecord(
  db: FastidiousDatabase,
  entity: Exclude<DailyLogEntity, "category">,
  entityId: string,
  now: EpochMs,
): Promise<LocalOperationResult<DailyLogRecord>> {
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const table = dailyLogTable(db, entity);
  const current = await table.get(entityId);
  if (!current || current.logId !== meta.logId) return failure("record_not_found", "Record was not found.");
  const deleted = { ...current, deletedAt: now, updatedAt: now } as DailyLogRecord;
  const queuedId = mutationId();
  return db.transaction(
    "rw",
    [db.meta, table, db.groceryItems, db.exercise, db.mutations, db.pendingImages],
    async () => {
      await table.put(deleted);
      if (entity === "food") await db.groceryItems.where("foodId").equals(entityId).modify({ foodId: null, updatedAt: now });
      if (entity === "activity") await db.exercise.where("activityId").equals(entityId).modify({ activityId: null, updatedAt: now });
      if (["food", "meal", "activity", "checklistItem", "groceryItem"].includes(entity)) {
        const pending = await db.pendingImages.where("[entityType+entityId]").equals([entity, entityId]).toArray();
        await db.pendingImages.bulkDelete(pending.map((item) => item.id));
      }
      const mutation = await appendMutation(db, meta, queuedId, entity, entityId, "delete", { id: entityId }, now);
      return { ok: true, value: { value: deleted, mutation } };
    },
  );
}

export async function deleteCategoryAndReassign(
  db: FastidiousDatabase,
  input: { categoryId: CategoryId; replacementCategoryId: CategoryId; now: EpochMs },
): Promise<LocalOperationResult<CategoryRecord>> {
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const [category, replacement] = await Promise.all([
    db.categories.get(input.categoryId),
    db.categories.get(input.replacementCategoryId),
  ]);
  if (
    !category || !replacement || category.logId !== meta.logId || replacement.logId !== meta.logId ||
    category.deletedAt !== null || replacement.deletedAt !== null || category.kind !== replacement.kind ||
    category.id === replacement.id
  ) {
    return failure("invalid_replacement_category", "Choose an active replacement category of the same kind.");
  }
  const deleted = { ...category, deletedAt: input.now, updatedAt: input.now };
  const queuedId = mutationId();
  return db.transaction(
    "rw",
    [db.meta, db.categories, db.foods, db.activities, db.mutations],
    async () => {
      await db.categories.put(deleted);
      if (category.kind === "food") {
        await db.foods.where("categoryId").equals(category.id).modify({ categoryId: replacement.id, updatedAt: input.now });
      } else {
        await db.activities.where("categoryId").equals(category.id).modify({ categoryId: replacement.id, updatedAt: input.now });
      }
      const mutation = await appendMutation(
        db,
        meta,
        queuedId,
        "category",
        category.id,
        "delete",
        { id: category.id, replacementCategoryId: replacement.id },
        input.now,
      );
      return { ok: true, value: { value: deleted, mutation } };
    },
  );
}

export async function clearCompletedGroceryItems(
  db: FastidiousDatabase,
  now: EpochMs,
): Promise<ValidationResult<{ value: number; mutations: LocalMutation[] }>> {
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const completed = await db.groceryItems
    .filter((item) => item.logId === meta.logId && item.deletedAt === null && item.inCart)
    .toArray();
  return db.transaction("rw", [db.meta, db.groceryItems, db.mutations], async () => {
    const mutations: LocalMutation[] = [];
    for (const item of completed) {
      const deleted = { ...item, updatedAt: now, deletedAt: now };
      await db.groceryItems.put(deleted);
      mutations.push(await appendMutation(
        db, meta, mutationId(), "groceryItem", item.id, "delete", { id: item.id }, now,
      ));
    }
    return { ok: true as const, value: { value: completed.length, mutations } };
  });
}

export async function saveExerciseEntry(
  db: FastidiousDatabase,
  input: { exercise: ExerciseRecord; activity?: ActivityRecord; now: EpochMs },
): Promise<ValidationResult<{ value: ExerciseRecord; mutations: LocalMutation[] }>> {
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const checkedExercise = validateExerciseRecord(input.exercise, input.now);
  if (!checkedExercise.ok) return checkedExercise;
  const checkedActivity = input.activity ? validateActivityRecord(input.activity) : undefined;
  if (checkedActivity && !checkedActivity.ok) return checkedActivity;
  if (checkedExercise.value.logId !== meta.logId || (checkedActivity?.value.logId ?? meta.logId) !== meta.logId) {
    return failure("wrong_log", "Record belongs to a different log.");
  }
  if (checkedActivity && checkedActivity.value.id !== checkedExercise.value.activityId) {
    return failure("activity_link_mismatch", "Exercise must link to the activity saved with it.");
  }
  if (!checkedActivity && checkedExercise.value.activityId) {
    const linked = await db.activities.get(checkedExercise.value.activityId);
    if (!linked || linked.logId !== meta.logId || linked.deletedAt !== null) {
      return failure("activity_not_found", "Linked activity was not found.");
    }
  }

  return db.transaction("rw", [db.meta, db.activities, db.exercise, db.mutations], async () => {
    const mutations: LocalMutation[] = [];
    if (checkedActivity) {
      await db.activities.put(checkedActivity.value);
      mutations.push(await appendMutation(
        db, meta, mutationId(), "activity", checkedActivity.value.id, "upsert", checkedActivity.value, input.now,
      ));
    }
    await db.exercise.put(checkedExercise.value);
    mutations.push(await appendMutation(
      db, meta, mutationId(), "exercise", checkedExercise.value.id, "upsert", checkedExercise.value, input.now,
    ));
    return { ok: true as const, value: { value: checkedExercise.value, mutations } };
  });
}

export async function updateNutritionTargets(
  db: FastidiousDatabase,
  targets: NutritionTargets,
  now: EpochMs,
): Promise<LocalOperationResult<NutritionTargets>> {
  const checked = validateNutritionTargets(targets);
  if (!checked.ok) return checked;
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const queuedId = mutationId();
  return db.transaction("rw", db.meta, db.nutritionTargets, db.mutations, async () => {
    await db.nutritionTargets.put({ key: PREFERENCES_KEY, ...checked.value });
    const mutation = await appendMutation(
      db, meta, queuedId, "nutritionTargets", PREFERENCES_KEY, "update", checked.value, now,
    );
    return { ok: true, value: { value: checked.value, mutation } };
  });
}

export async function toggleChecklistItemCompletion(
  db: FastidiousDatabase,
  input: { itemId: ChecklistItemId; at: EpochMs; timezone: string; now: EpochMs },
): Promise<LocalOperationResult<ChecklistCompletionRecord | null>> {
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const item = await db.checklistItems.get(input.itemId);
  if (!item || item.logId !== meta.logId || item.deletedAt !== null) {
    return failure("checklist_item_not_found", "Checklist item was not found.");
  }
  const periodKey = checklistPeriodKey(item.cadence, input.at, input.timezone);
  const existing = await db.checklistCompletions
    .filter((completion) => (
      completion.checklistItemId === item.id && completion.periodKey === periodKey && completion.deletedAt === null
    ))
    .first();
  const queuedId = mutationId();
  return db.transaction("rw", db.meta, db.checklistCompletions, db.mutations, async () => {
    if (existing) {
      await db.checklistCompletions.put({ ...existing, updatedAt: input.now, deletedAt: input.now });
      const mutation = await appendMutation(
        db, meta, queuedId, "checklistCompletion", existing.id, "delete", { id: existing.id }, input.now,
      );
      return { ok: true, value: { value: null, mutation } };
    }
    const completion: ChecklistCompletionRecord = {
      id: crypto.randomUUID() as ChecklistCompletionId,
      logId: meta.logId!,
      checklistItemId: item.id,
      periodKey,
      completedAt: input.now,
      revision: 0,
      updatedAt: input.now,
      deletedAt: null,
    };
    await db.checklistCompletions.put(completion);
    const mutation = await appendMutation(
      db, meta, queuedId, "checklistCompletion", completion.id, "upsert", completion, input.now,
    );
    return { ok: true, value: { value: completion, mutation } };
  });
}

export async function deleteChecklistItem(
  db: FastidiousDatabase,
  input: { itemId: ChecklistItemId; now: EpochMs },
): Promise<LocalOperationResult<ChecklistItemRecord>> {
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const item = await db.checklistItems.get(input.itemId);
  if (!item || item.logId !== meta.logId || item.deletedAt !== null) {
    return failure("checklist_item_not_found", "Checklist item was not found.");
  }
  const deleted = { ...item, updatedAt: input.now, deletedAt: input.now };
  const queuedId = mutationId();
  return db.transaction(
    "rw",
    [db.meta, db.checklistItems, db.checklistCompletions, db.mutations],
    async () => {
      await db.checklistItems.put(deleted);
      await db.checklistCompletions.where("checklistItemId").equals(item.id)
        .modify({ updatedAt: input.now, deletedAt: input.now });
      const mutation = await appendMutation(
        db, meta, queuedId, "checklistItem", item.id, "delete", { id: item.id }, input.now,
      );
      return { ok: true, value: { value: deleted, mutation } };
    },
  );
}

function activeFast(fasts: readonly FastRecord[]): FastRecord | undefined {
  return fasts.find((fast) => fast.deletedAt === null && fast.endAt === null);
}

export interface StartFastInput {
  id?: FastId;
  startAt: EpochMs;
  goalHours: number;
  now: EpochMs;
}

export async function startFast(db: FastidiousDatabase, input: StartFastInput): Promise<LocalOperationResult<FastRecord>> {
  const id = input.id ?? (crypto.randomUUID() as FastId);
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const existing = await currentFasts(db);
  const validated = createFastRecord(
    { id, logId: meta.logId!, startAt: input.startAt, endAt: null, goalHours: input.goalHours },
    input.now,
    existing,
  );
  if (!validated.ok) return validated;

  return db.transaction("rw", db.meta, db.fasts, db.mutations, async () => {
    const transactionValidation = createFastRecord(
      { id, logId: meta.logId!, startAt: input.startAt, endAt: null, goalHours: input.goalHours },
      input.now,
      await currentFasts(db),
    );
    if (!transactionValidation.ok) return transactionValidation;
    await db.fasts.add(transactionValidation.value);
    const mutation = await appendMutation(
      db,
      meta,
      queuedId,
      "fast",
      id,
      "start",
      transactionValidation.value,
      input.now,
    );
    return { ok: true, value: { value: transactionValidation.value, mutation } };
  });
}

export interface EditActiveFastInput {
  startAt: EpochMs;
  goalHours: number;
  now: EpochMs;
}

export async function editActiveFast(
  db: FastidiousDatabase,
  input: EditActiveFastInput,
): Promise<LocalOperationResult<FastRecord>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const existing = await currentFasts(db);
  const active = activeFast(existing);
  if (!active) return failure("active_fast_not_found", "There is no active fast to edit.");
  const validated = createFastRecord(
    { ...active, startAt: input.startAt, goalHours: input.goalHours, updatedAt: input.now },
    input.now,
    existing,
  );
  if (!validated.ok) return validated;
  return db.transaction("rw", db.meta, db.fasts, db.mutations, async () => {
    await db.fasts.put(validated.value);
    const mutation = await appendMutation(db, meta, queuedId, "fast", active.id, "upsert", validated.value, input.now);
    return { ok: true, value: { value: validated.value, mutation } };
  });
}

export async function endFast(
  db: FastidiousDatabase,
  input: { endAt: EpochMs; now: EpochMs },
): Promise<LocalOperationResult<FastRecord>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const existing = await currentFasts(db);
  const active = activeFast(existing);
  if (!active) return failure("active_fast_not_found", "There is no active fast to end.");
  const validated = createFastRecord({ ...active, endAt: input.endAt, updatedAt: input.now }, input.now, existing);
  if (!validated.ok) return validated;
  return db.transaction("rw", db.meta, db.fasts, db.mutations, async () => {
    await db.fasts.put(validated.value);
    const mutation = await appendMutation(db, meta, queuedId, "fast", active.id, "end", validated.value, input.now);
    return { ok: true, value: { value: validated.value, mutation } };
  });
}

export async function resumeFast(
  db: FastidiousDatabase,
  input: { id: FastId; now: EpochMs },
): Promise<LocalOperationResult<FastRecord>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const existing = await currentFasts(db);
  const fast = existing.find((item) => item.id === input.id && item.deletedAt === null);
  if (!fast) return failure("fast_not_found", "The fast was not found.");
  if (fast.endAt === null) return failure("fast_already_active", "The fast is already active.");
  const validated = createFastRecord({ ...fast, endAt: null, updatedAt: input.now }, input.now, existing);
  if (!validated.ok) return validated;
  return db.transaction("rw", db.meta, db.fasts, db.mutations, async () => {
    await db.fasts.put(validated.value);
    const mutation = await appendMutation(db, meta, queuedId, "fast", fast.id, "resume", validated.value, input.now);
    return { ok: true, value: { value: validated.value, mutation } };
  });
}

export interface PastFastInput {
  id?: FastId;
  startAt: EpochMs;
  endAt: EpochMs;
  goalHours: number;
  now: EpochMs;
}

export async function upsertPastFast(
  db: FastidiousDatabase,
  input: PastFastInput,
): Promise<LocalOperationResult<FastRecord>> {
  const id = input.id ?? (crypto.randomUUID() as FastId);
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const existing = await currentFasts(db);
  const previous = existing.find((fast) => fast.id === id);
  const validated = createFastRecord(
    {
      ...previous,
      id,
      logId: meta.logId!,
      startAt: input.startAt,
      endAt: input.endAt,
      goalHours: input.goalHours,
      updatedAt: input.now,
      deletedAt: null,
    },
    input.now,
    existing,
  );
  if (!validated.ok) return validated;
  return db.transaction("rw", db.meta, db.fasts, db.mutations, async () => {
    await db.fasts.put(validated.value);
    const mutation = await appendMutation(db, meta, queuedId, "fast", id, "upsert", validated.value, input.now);
    return { ok: true, value: { value: validated.value, mutation } };
  });
}

async function setFastDeleted(
  db: FastidiousDatabase,
  id: FastId,
  now: EpochMs,
  deleted: boolean,
): Promise<LocalOperationResult<FastRecord>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const existing = await currentFasts(db);
  const fast = existing.find((item) => item.id === id);
  if (!fast) return failure("fast_not_found", "The fast was not found.");
  const candidate = { ...fast, deletedAt: deleted ? now : null, updatedAt: now };
  if (!deleted) {
    const validated = createFastRecord(candidate, now, existing);
    if (!validated.ok) return validated;
  }
  return db.transaction("rw", db.meta, db.fasts, db.mutations, async () => {
    await db.fasts.put(candidate);
    const operation = deleted ? "delete" : "restore";
    const mutation = await appendMutation(db, meta, queuedId, "fast", id, operation, candidate, now);
    return { ok: true, value: { value: candidate, mutation } };
  });
}

export const deleteFast = (db: FastidiousDatabase, input: { id: FastId; now: EpochMs }) =>
  setFastDeleted(db, input.id, input.now, true);
export const restoreFast = (db: FastidiousDatabase, input: { id: FastId; now: EpochMs }) =>
  setFastDeleted(db, input.id, input.now, false);

export interface AddWeightInput {
  id?: WeightId;
  measuredAt: EpochMs;
  kilograms: number;
  now: EpochMs;
}

export async function addWeight(
  db: FastidiousDatabase,
  input: AddWeightInput,
): Promise<LocalOperationResult<WeightRecord>> {
  const id = input.id ?? (crypto.randomUUID() as WeightId);
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const validated = createWeightRecord({ ...input, id, logId: meta.logId! }, input.now);
  if (!validated.ok) return validated;
  return db.transaction("rw", db.meta, db.weights, db.mutations, async () => {
    await db.weights.put(validated.value);
    const mutation = await appendMutation(db, meta, queuedId, "weight", id, "upsert", validated.value, input.now);
    return { ok: true, value: { value: validated.value, mutation } };
  });
}

async function setWeightDeleted(
  db: FastidiousDatabase,
  id: WeightId,
  now: EpochMs,
  deleted: boolean,
): Promise<LocalOperationResult<WeightRecord>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const weight = await db.weights.get(id);
  if (!weight) return failure("weight_not_found", "The weight was not found.");
  const candidate = { ...weight, deletedAt: deleted ? now : null, updatedAt: now };
  const validated = createWeightRecord(candidate, now);
  if (!validated.ok) return validated;
  return db.transaction("rw", db.meta, db.weights, db.mutations, async () => {
    await db.weights.put(validated.value);
    const operation = deleted ? "delete" : "restore";
    const mutation = await appendMutation(db, meta, queuedId, "weight", id, operation, validated.value, now);
    return { ok: true, value: { value: validated.value, mutation } };
  });
}

export const deleteWeight = (db: FastidiousDatabase, input: { id: WeightId; now: EpochMs }) =>
  setWeightDeleted(db, input.id, input.now, true);
export const restoreWeight = (db: FastidiousDatabase, input: { id: WeightId; now: EpochMs }) =>
  setWeightDeleted(db, input.id, input.now, false);

export async function updatePreferences(
  db: FastidiousDatabase,
  input: { preferences: LogPreferences; now: EpochMs },
): Promise<LocalOperationResult<LogPreferences>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const validated = validateLogPreferences(input.preferences);
  if (!validated.ok) return validated;
  const stored: StoredPreferences = { key: PREFERENCES_KEY, ...validated.value };
  const previous = await db.preferences.get(PREFERENCES_KEY);
  const patch = Object.fromEntries(
    Object.entries(validated.value).filter(([key, value]) => previous?.[key as keyof LogPreferences] !== value),
  );
  return db.transaction("rw", db.meta, db.preferences, db.mutations, async () => {
    await db.preferences.put(stored);
    const mutation = await appendMutation(
      db,
      meta,
      queuedId,
      "preferences",
      PREFERENCES_KEY,
      "update",
      patch,
      input.now,
    );
    return { ok: true, value: { value: validated.value, mutation } };
  });
}

function withoutKey(preferences: StoredPreferences): LogPreferences {
  const { key: _key, ...value } = preferences;
  return value;
}

function targetsWithoutKey(targets: StoredNutritionTargets | undefined): NutritionTargets {
  if (!targets) return { calories: null, proteinGrams: null, fiberGrams: null };
  const { key: _key, ...value } = targets;
  return value;
}

function validateDailyCollection<T extends DailyLogRecord>(
  entity: DailyLogEntity,
  records: readonly T[],
  logId: NonNullable<LocalMeta["logId"]>,
  now: EpochMs,
): ValidationResult<T[]> {
  const values: T[] = [];
  for (const record of records) {
    const checked = validateDailyLogRecord(entity, { ...record, logId }, now);
    if (!checked.ok) return checked;
    values.push(checked.value as T);
  }
  return { ok: true, value: values };
}

async function validateReplacement(
  db: FastidiousDatabase,
  snapshot: LocalSnapshot,
  now: EpochMs,
): Promise<ValidationResult<LocalSnapshot>> {
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const preferences = validateLogPreferences(snapshot.preferences);
  if (!preferences.ok) return preferences;
  const nutritionTargets = validateNutritionTargets(snapshot.nutritionTargets);
  if (!nutritionTargets.ok) return nutritionTargets;
  const fasts: FastRecord[] = [];
  for (const fast of snapshot.fasts) {
    const checked = validateFastRecord({ ...fast, logId: meta.logId! }, now);
    if (!checked.ok) return checked;
    fasts.push(checked.value);
  }
  const collection = validateFastCollection(fasts);
  if (!collection.ok) return collection;
  const weights: WeightRecord[] = [];
  for (const weight of snapshot.weights) {
    const checked = validateWeightRecord({ ...weight, logId: meta.logId! }, now);
    if (!checked.ok) return checked;
    weights.push(checked.value);
  }
  const categories = validateDailyCollection("category", snapshot.categories, meta.logId!, now);
  if (!categories.ok) return categories;
  const foods = validateDailyCollection("food", snapshot.foods, meta.logId!, now);
  if (!foods.ok) return foods;
  const meals = validateDailyCollection("meal", snapshot.meals, meta.logId!, now);
  if (!meals.ok) return meals;
  const activities = validateDailyCollection("activity", snapshot.activities, meta.logId!, now);
  if (!activities.ok) return activities;
  const exercise = validateDailyCollection("exercise", snapshot.exercise, meta.logId!, now);
  if (!exercise.ok) return exercise;
  const checklistItems = validateDailyCollection("checklistItem", snapshot.checklistItems, meta.logId!, now);
  if (!checklistItems.ok) return checklistItems;
  const checklistCompletions = validateDailyCollection("checklistCompletion", snapshot.checklistCompletions, meta.logId!, now);
  if (!checklistCompletions.ok) return checklistCompletions;
  const groceryItems = validateDailyCollection("groceryItem", snapshot.groceryItems, meta.logId!, now);
  if (!groceryItems.ok) return groceryItems;
  return validateSnapshotReferences({
    fasts,
    weights,
    categories: categories.value,
    foods: foods.value,
    meals: meals.value,
    activities: activities.value,
    exercise: exercise.value,
    checklistItems: checklistItems.value,
    checklistCompletions: checklistCompletions.value,
    groceryItems: groceryItems.value,
    nutritionTargets: nutritionTargets.value,
    preferences: preferences.value,
  });
}

export async function replaceFromImport(
  db: FastidiousDatabase,
  input: { snapshot: LocalSnapshot; now: EpochMs },
): Promise<LocalOperationResult<LocalSnapshot>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  const validated = await validateReplacement(db, input.snapshot, input.now);
  if (!validated.ok) return validated;
  const oldPreferences = await db.preferences.get(PREFERENCES_KEY);
  if (!oldPreferences) return failure("preferences_not_found", "Log preferences are not installed.");

  return db.transaction(
    "rw",
    [
      db.meta, db.fasts, db.weights, db.categories, db.foods, db.meals, db.activities, db.exercise,
      db.checklistItems, db.checklistCompletions, db.groceryItems, db.nutritionTargets,
      db.preferences, db.mutations, db.pendingImages, db.preImportBackup,
    ],
    async () => {
      await db.pendingImages.clear();
      await db.preImportBackup.put({
        key: BACKUP_KEY,
        createdAt: input.now,
        dataGeneration: meta.dataGeneration,
        fasts: await db.fasts.toArray(),
        weights: await db.weights.toArray(),
        categories: await db.categories.toArray(),
        foods: await db.foods.toArray(),
        meals: await db.meals.toArray(),
        activities: await db.activities.toArray(),
        exercise: await db.exercise.toArray(),
        checklistItems: await db.checklistItems.toArray(),
        checklistCompletions: await db.checklistCompletions.toArray(),
        groceryItems: await db.groceryItems.toArray(),
        nutritionTargets: targetsWithoutKey(await db.nutritionTargets.get(PREFERENCES_KEY)),
        preferences: withoutKey(oldPreferences),
      });
      await replaceAllSnapshotTables(db, validated.value);
      const mutation = await appendGenerationReset(db, meta, queuedId, "replace", validated.value, input.now);
      return { ok: true, value: { value: validated.value, mutation } };
    },
  );
}

async function replaceTable<T, Key>(table: Table<T, Key>, records: readonly T[]): Promise<void> {
  await table.clear();
  if (records.length > 0) await table.bulkPut([...records]);
}

async function replaceAllSnapshotTables(db: FastidiousDatabase, snapshot: LocalSnapshot): Promise<void> {
  await replaceTable(db.fasts, snapshot.fasts);
  await replaceTable(db.weights, snapshot.weights);
  await replaceTable(db.categories, snapshot.categories);
  await replaceTable(db.foods, snapshot.foods);
  await replaceTable(db.meals, snapshot.meals);
  await replaceTable(db.activities, snapshot.activities);
  await replaceTable(db.exercise, snapshot.exercise);
  await replaceTable(db.checklistItems, snapshot.checklistItems);
  await replaceTable(db.checklistCompletions, snapshot.checklistCompletions);
  await replaceTable(db.groceryItems, snapshot.groceryItems);
  await db.nutritionTargets.put({ key: PREFERENCES_KEY, ...snapshot.nutritionTargets });
  await db.preferences.put({ key: PREFERENCES_KEY, ...snapshot.preferences });
}

async function appendGenerationReset(
  db: FastidiousDatabase,
  meta: LocalMeta,
  id: MutationId,
  operation: "replace" | "clear",
  payload: unknown,
  createdAt: number,
): Promise<LocalMutation> {
  const pendingReset = await db.mutations
    .filter((mutation) => mutation.entityType === "log" && (mutation.operation === "replace" || mutation.operation === "clear"))
    .first();
  const generation = pendingReset?.status === "pending" ? meta.dataGeneration : meta.dataGeneration + 1;
  await db.mutations.clear();
  await db.meta.update(META_KEY, { dataGeneration: generation, nextMutationSequence: 1 });
  const next = { ...meta, dataGeneration: generation, nextMutationSequence: 1 };
  return appendMutation(db, next, id, "log", meta.logId!, operation, payload, createdAt);
}

export async function clearData(
  db: FastidiousDatabase,
  input: { now: EpochMs },
): Promise<LocalOperationResult<null>> {
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  return db.transaction(
    "rw",
    [
      db.meta, db.fasts, db.weights, db.categories, db.foods, db.meals, db.activities, db.exercise,
      db.checklistItems, db.checklistCompletions, db.groceryItems, db.nutritionTargets,
      db.mutations, db.pendingImages, db.preImportBackup,
    ],
    async () => {
      await Promise.all([
        db.fasts.clear(), db.weights.clear(), db.categories.clear(), db.foods.clear(), db.meals.clear(),
        db.activities.clear(), db.exercise.clear(), db.checklistItems.clear(), db.checklistCompletions.clear(),
        db.groceryItems.clear(), db.nutritionTargets.clear(), db.pendingImages.clear(), db.preImportBackup.clear(),
      ]);
      const mutation = await appendGenerationReset(db, meta, queuedId, "clear", {}, input.now);
      return { ok: true, value: { value: null, mutation } };
    },
  );
}

export async function restorePreImportBackup(
  db: FastidiousDatabase,
  input: { now: EpochMs },
): Promise<LocalOperationResult<LocalSnapshot>> {
  const backup = await db.preImportBackup.get(BACKUP_KEY);
  if (!backup) return failure("backup_not_found", "No import backup is available.");
  const { key: _key, createdAt: _createdAt, dataGeneration: _dataGeneration, ...snapshot } = backup;
  const validated = await validateReplacement(db, snapshot, input.now);
  if (!validated.ok) return validated;
  const queuedId = mutationId();
  const meta = await state(db);
  if ("ok" in meta) return meta;
  return db.transaction(
    "rw",
    [
      db.meta, db.fasts, db.weights, db.categories, db.foods, db.meals, db.activities, db.exercise,
      db.checklistItems, db.checklistCompletions, db.groceryItems, db.nutritionTargets,
      db.preferences, db.mutations, db.pendingImages, db.preImportBackup,
    ],
    async () => {
      await db.pendingImages.clear();
      await replaceAllSnapshotTables(db, validated.value);
      await db.preImportBackup.clear();
      const mutation = await appendGenerationReset(db, meta, queuedId, "replace", validated.value, input.now);
      return { ok: true, value: { value: validated.value, mutation } };
    },
  );
}
