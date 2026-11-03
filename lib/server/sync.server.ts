import type {
  ActivityId,
  ActivityRecord,
  CategoryId,
  CategoryRecord,
  ChecklistCompletionId,
  ChecklistCompletionRecord,
  ChecklistItemId,
  ChecklistItemRecord,
  EpochMs,
  ExerciseId,
  ExerciseRecord,
  FastId,
  FoodId,
  FoodRecord,
  GroceryItemId,
  GroceryItemRecord,
  LogId,
  LogPreferences,
  MealId,
  MealRecord,
  WeightId,
} from "../domain/types";
import type { DailyLogEntity, ServerChange } from "../local-db/schema";
import { MAX_SYNC_CHANGES, SYNC_PROTOCOL_VERSION, type SyncRequest, type SyncResponse } from "../sync/contract";
import { resetServerData, validateDataReplacement } from "./data-reset.server";
import { RepositoryError } from "./errors.server";
import { loadSnapshot, type AuthContext } from "./identity.server";
import { ChangeRepository, type ChangeRecord } from "./repositories/changes.server";
import { DailyLogRepository } from "./repositories/daily-log.server";
import { FastRepository } from "./repositories/fasts.server";
import { LogRepository } from "./repositories/logs.server";
import { MutationRepository } from "./repositories/mutations.server";
import { PreferencesRepository } from "./repositories/preferences.server";
import { WeightRepository } from "./repositories/weights.server";

export interface SyncMutationHooks {
  notificationStatements?(input: { logId: LogId; entity: "fast" | "weight" | "preferences"; operation: string; payload: unknown }): D1PreparedStatement[];
}

export async function synchronize(
  db: D1Database,
  auth: AuthContext,
  request: SyncRequest,
  now: number = Date.now(),
  hooks: SyncMutationHooks = {},
): Promise<SyncResponse> {
  const arrivedAt = now as EpochMs;
  const logs = new LogRepository(db);
  const current = await logs.get(auth.log.id);
  if (!current || current.credentialGeneration !== auth.log.credentialGeneration) {
    throw new RepositoryError("revoked", "This access link was revoked.");
  }
  if (request.mutations.some((mutation) => mutation.dataGeneration !== request.dataGeneration)) {
    throw new RepositoryError("validation_failure", "Mutation data generation does not match the request.");
  }
  const firstMutation = request.mutations[0];
  const startsGenerationReset =
    request.dataGeneration === current.dataGeneration + 1 &&
    firstMutation?.entity === "data" &&
    (firstMutation.operation === "clear" || firstMutation.operation === "replace");
  if (request.dataGeneration !== current.dataGeneration && !startsGenerationReset) {
    const snapshot = await loadSnapshot(db, current);
    return {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      cursor: snapshot.cursor,
      dataGeneration: current.dataGeneration,
      credentialGeneration: current.credentialGeneration,
      serverGeneration: snapshot.serverGeneration,
      acknowledgedMutationIds: [],
      changes: [],
      hasMore: false,
      snapshot,
    };
  }

  const mutations = new MutationRepository(db);
  const fasts = new FastRepository(db);
  const weights = new WeightRepository(db);
  const preferences = new PreferencesRepository(db);
  const dailyLog = new DailyLogRepository(db);
  const applied = await mutations.applyBatch(
    current.id,
    request.mutations.map((mutation) => ({ ...mutation, mutationId: mutation.id })),
    async (mutation) => {
      if (mutation.entity === "fast") {
        const payload = objectPayload(mutation.payload);
        const id = requiredString(payload.id) as FastId;
        const notificationStatements = hooks.notificationStatements?.({
          logId: current.id,
          entity: "fast",
          operation: mutation.operation,
          payload: mutation.payload,
        }) ?? [];
        if (mutation.operation === "delete") {
          return (await fasts.delete(current.id, id, arrivedAt, mutation.id, notificationStatements)).revision;
        }
        const saveInput = {
          id,
          logId: current.id,
          startAt: requiredNumber(payload.startAt) as EpochMs,
          endAt: nullableNumber(payload.endAt) as EpochMs | null,
          goalHours: requiredNumber(payload.goalHours),
          now: arrivedAt,
          mutationId: mutation.id,
        };
        return (
          await fasts.saveReplacingActive(
            saveInput,
            notificationStatements,
          )
        ).revision;
      }
      if (mutation.entity === "weight") {
        const payload = objectPayload(mutation.payload);
        const id = requiredString(payload.id) as WeightId;
        const notificationStatements = hooks.notificationStatements?.({
          logId: current.id,
          entity: "weight",
          operation: mutation.operation,
          payload: mutation.payload,
        }) ?? [];
        if (mutation.operation === "delete") {
          return (await weights.delete(current.id, id, arrivedAt, mutation.id, notificationStatements)).revision;
        }
        return (
          await weights.save({
            id,
            logId: current.id,
            measuredAt: requiredNumber(payload.measuredAt) as EpochMs,
            kilograms: requiredNumber(payload.kilograms),
            now: arrivedAt,
            mutationId: mutation.id,
          }, notificationStatements)
        ).revision;
      }
      if (isDailyLogEntity(mutation.entity)) {
        const payload = objectPayload(mutation.payload);
        const id = requiredString(payload.id);
        if (mutation.operation === "delete") {
          const replacementCategoryId = mutation.entity === "category"
            ? requiredString(payload.replacementCategoryId) as CategoryId
            : undefined;
          return dailyLog.delete(current.id, mutation.entity, id, arrivedAt, mutation.id, replacementCategoryId);
        }
        if (mutation.operation !== "upsert") {
          throw new RepositoryError("validation_failure", "Daily-log mutation operation is not supported.");
        }
        return dailyLog.save(current.id, mutation.entity, payload, arrivedAt, mutation.id);
      }
      if (mutation.entity === "nutritionTargets" && mutation.operation === "update") {
        return dailyLog.updateNutritionTargets(current.id, mutation.payload, arrivedAt, mutation.id);
      }
      if (mutation.entity === "preferences" && mutation.operation === "update") {
        const updated = await preferences.update(
          current.id,
          objectPayload(mutation.payload),
          arrivedAt,
          mutation.id,
          hooks.notificationStatements?.({
            logId: current.id,
            entity: "preferences",
            operation: mutation.operation,
            payload: mutation.payload,
          }) ?? [],
        );
        const log = await logs.get(current.id);
        if (!log) throw new RepositoryError("not_found", "Log was not found.");
        void updated;
        return log.revision;
      }
      if (mutation.entity === "data" && (mutation.operation === "clear" || mutation.operation === "replace")) {
        if (!startsGenerationReset || mutation.id !== firstMutation?.id) {
          throw new RepositoryError("validation_failure", "A data reset must begin a new data generation.");
        }
        const replacement = mutation.operation === "replace"
          ? validateDataReplacement(mutation.payload, current.id, arrivedAt)
          : undefined;
        return resetServerData(db, {
          logId: current.id,
          mutationId: mutation.id,
          expectedGeneration: request.dataGeneration,
          operation: mutation.operation,
          replacement,
          now: arrivedAt,
        });
      }
      throw new RepositoryError("validation_failure", "Mutation entity or operation is not supported.");
    },
  );

  const afterMutations = await logs.get(current.id);
  if (!afterMutations) throw new RepositoryError("not_found", "Log was not found.");
  const changesRepository = new ChangeRepository(db);
  if (await changesRepository.requiresFullSnapshot(current.id, request.cursor)) {
    const snapshot = await loadSnapshot(db, afterMutations);
    return responseBase(afterMutations, applied.map((item) => item.mutationId), [], false, snapshot);
  }
  const fetched = await changesRepository.fetchAfter(current.id, request.cursor, MAX_SYNC_CHANGES + 1);
  const page = fetched.slice(0, MAX_SYNC_CHANGES);
  const changes = await mapChanges(db, current.id, page);
  const cursor = page.at(-1)?.revision ?? request.cursor;
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    cursor,
    dataGeneration: afterMutations.dataGeneration,
    credentialGeneration: afterMutations.credentialGeneration,
    serverGeneration: 1,
    acknowledgedMutationIds: applied.map((item) => item.mutationId),
    changes,
    hasMore: fetched.length > page.length,
  };
}

function responseBase(
  log: Awaited<ReturnType<LogRepository["get"]>> & {},
  acknowledgedMutationIds: SyncResponse["acknowledgedMutationIds"],
  changes: ServerChange[],
  hasMore: boolean,
  snapshot?: SyncResponse["snapshot"],
): SyncResponse {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    cursor: snapshot?.cursor ?? log.revision,
    dataGeneration: log.dataGeneration,
    credentialGeneration: log.credentialGeneration,
    serverGeneration: snapshot?.serverGeneration ?? 1,
    acknowledgedMutationIds,
    changes,
    hasMore,
    snapshot,
  };
}

async function mapChanges(db: D1Database, logId: LogId, changes: ChangeRecord[]): Promise<ServerChange[]> {
  const changedTypes = new Set(changes.map((change) => change.entityType));
  const dailyLog = new DailyLogRepository(db);
  const [
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
    nutritionTargets,
  ] = await Promise.all([
    changedTypes.has("fast") ? new FastRepository(db).listSnapshot(logId) : Promise.resolve([]),
    changedTypes.has("weight") ? new WeightRepository(db).listSnapshot(logId) : Promise.resolve([]),
    changedTypes.has("category") ? dailyLog.listEntity(logId, "category") : Promise.resolve([]),
    changedTypes.has("food") ? dailyLog.listEntity(logId, "food") : Promise.resolve([]),
    changedTypes.has("meal") ? dailyLog.listEntity(logId, "meal") : Promise.resolve([]),
    changedTypes.has("activity") ? dailyLog.listEntity(logId, "activity") : Promise.resolve([]),
    changedTypes.has("exercise") ? dailyLog.listEntity(logId, "exercise") : Promise.resolve([]),
    changedTypes.has("checklistItem") ? dailyLog.listEntity(logId, "checklistItem") : Promise.resolve([]),
    changedTypes.has("checklistCompletion") ? dailyLog.listEntity(logId, "checklistCompletion") : Promise.resolve([]),
    changedTypes.has("groceryItem") ? dailyLog.listEntity(logId, "groceryItem") : Promise.resolve([]),
    changedTypes.has("nutritionTargets")
      ? dailyLog.getNutritionTargets(logId)
      : Promise.resolve({ calories: null, proteinGrams: null, fiberGrams: null }),
  ]);
  const fastById = new Map(fasts.map((record) => [record.id, record]));
  const weightById = new Map(weights.map((record) => [record.id, record]));
  const categoryById = new Map((categories as CategoryRecord[]).map((record) => [record.id, record]));
  const foodById = new Map((foods as FoodRecord[]).map((record) => [record.id, record]));
  const mealById = new Map((meals as MealRecord[]).map((record) => [record.id, record]));
  const activityById = new Map((activities as ActivityRecord[]).map((record) => [record.id, record]));
  const exerciseById = new Map((exercise as ExerciseRecord[]).map((record) => [record.id, record]));
  const checklistItemById = new Map((checklistItems as ChecklistItemRecord[]).map((record) => [record.id, record]));
  const checklistCompletionById = new Map((checklistCompletions as ChecklistCompletionRecord[]).map((record) => [record.id, record]));
  const groceryItemById = new Map((groceryItems as GroceryItemRecord[]).map((record) => [record.id, record]));
  return changes.flatMap((change): ServerChange[] => {
    const deleted = change.operation === "delete";
    switch (change.entityType) {
      case "fast": return [{ revision: change.revision, entityType: "fast", entityId: change.entityId as FastId, record: deleted ? null : fastById.get(change.entityId as FastId) ?? null }];
      case "weight": return [{ revision: change.revision, entityType: "weight", entityId: change.entityId as WeightId, record: deleted ? null : weightById.get(change.entityId as WeightId) ?? null }];
      case "category": return [{
        revision: change.revision,
        entityType: "category",
        entityId: change.entityId as CategoryId,
        record: deleted ? null : categoryById.get(change.entityId as CategoryId) ?? null,
        replacementCategoryId: deleted
          ? (change.payload as { replacementCategoryId?: CategoryId }).replacementCategoryId
          : undefined,
      }];
      case "food": return [{ revision: change.revision, entityType: "food", entityId: change.entityId as FoodId, record: deleted ? null : foodById.get(change.entityId as FoodId) ?? null }];
      case "meal": return [{ revision: change.revision, entityType: "meal", entityId: change.entityId as MealId, record: deleted ? null : mealById.get(change.entityId as MealId) ?? null }];
      case "activity": return [{ revision: change.revision, entityType: "activity", entityId: change.entityId as ActivityId, record: deleted ? null : activityById.get(change.entityId as ActivityId) ?? null }];
      case "exercise": return [{ revision: change.revision, entityType: "exercise", entityId: change.entityId as ExerciseId, record: deleted ? null : exerciseById.get(change.entityId as ExerciseId) ?? null }];
      case "checklistItem": return [{ revision: change.revision, entityType: "checklistItem", entityId: change.entityId as ChecklistItemId, record: deleted ? null : checklistItemById.get(change.entityId as ChecklistItemId) ?? null }];
      case "checklistCompletion": return [{ revision: change.revision, entityType: "checklistCompletion", entityId: change.entityId as ChecklistCompletionId, record: deleted ? null : checklistCompletionById.get(change.entityId as ChecklistCompletionId) ?? null }];
      case "groceryItem": return [{ revision: change.revision, entityType: "groceryItem", entityId: change.entityId as GroceryItemId, record: deleted ? null : groceryItemById.get(change.entityId as GroceryItemId) ?? null }];
      case "preferences": return [{ revision: change.revision, entityType: "preferences", entityId: "active", record: change.payload as LogPreferences }];
      case "nutritionTargets": return [{ revision: change.revision, entityType: "nutritionTargets", entityId: "active", record: nutritionTargets }];
      default: return [];
    }
  });
}

const DAILY_LOG_ENTITIES = new Set<DailyLogEntity>([
  "category", "food", "meal", "activity", "exercise", "checklistItem", "checklistCompletion", "groceryItem",
]);

function isDailyLogEntity(value: string): value is DailyLogEntity {
  return DAILY_LOG_ENTITIES.has(value as DailyLogEntity);
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RepositoryError("validation_failure", "Mutation payload must be an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new RepositoryError("validation_failure", "Mutation payload is invalid.");
  return value;
}

function requiredNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RepositoryError("validation_failure", "Mutation payload is invalid.");
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  if (value === null) return null;
  return requiredNumber(value);
}
