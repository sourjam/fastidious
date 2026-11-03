import type {
  ActivityRecord,
  CategoryId,
  CategoryRecord,
  ChecklistCompletionRecord,
  ChecklistItemRecord,
  EpochMs,
  ExerciseRecord,
  FoodRecord,
  GroceryItemRecord,
  LogId,
  MealRecord,
  MutationId,
  NutritionTargets,
  ValidationResult,
} from "../../domain/types";
import type { DailyLogEntity, DailyLogSnapshot } from "../../local-db/schema";
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
} from "../../validation/daily-log";
import { asNullableNumber, asNumber, commitRevisionChange } from "../db.server";
import { databaseFailure, RepositoryError } from "../errors.server";

export type DailyLogRecord =
  | CategoryRecord
  | FoodRecord
  | MealRecord
  | ActivityRecord
  | ExerciseRecord
  | ChecklistItemRecord
  | ChecklistCompletionRecord
  | GroceryItemRecord;

const ENTITIES: DailyLogEntity[] = [
  "category",
  "food",
  "meal",
  "activity",
  "exercise",
  "checklistItem",
  "checklistCompletion",
  "groceryItem",
];

function validateRecord(entity: DailyLogEntity, value: unknown, logId: LogId, now: EpochMs): DailyLogRecord {
  const candidate = typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value, logId, revision: 0, updatedAt: now, deletedAt: null }
    : value;
  let result: ValidationResult<DailyLogRecord>;
  switch (entity) {
    case "category": result = validateCategoryRecord(candidate); break;
    case "food": result = validateFoodRecord(candidate); break;
    case "meal": result = validateMealRecord(candidate, now); break;
    case "activity": result = validateActivityRecord(candidate); break;
    case "exercise": result = validateExerciseRecord(candidate, now); break;
    case "checklistItem": result = validateChecklistItemRecord(candidate); break;
    case "checklistCompletion": result = validateChecklistCompletionRecord(candidate, now); break;
    case "groceryItem": result = validateGroceryItemRecord(candidate); break;
  }
  if (!result.ok) throw new RepositoryError("validation_failure", result.message);
  return result.value;
}

function tableName(entity: DailyLogEntity): string {
  switch (entity) {
    case "category": return "categories";
    case "food": return "foods";
    case "meal": return "meals";
    case "activity": return "activities";
    case "exercise": return "exercise_entries";
    case "checklistItem": return "checklist_items";
    case "checklistCompletion": return "checklist_completions";
    case "groceryItem": return "grocery_items";
  }
}

function saveStatement(db: D1Database, entity: DailyLogEntity, record: DailyLogRecord): D1PreparedStatement {
  const revision = "(SELECT revision FROM logs WHERE id = ?)";
  switch (entity) {
    case "category": {
      const value = record as CategoryRecord;
      return db.prepare(
        `INSERT INTO categories (id, log_id, kind, name, sort_order, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ${revision}, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, sort_order = excluded.sort_order,
           revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE categories.log_id = excluded.log_id`,
      ).bind(value.id, value.logId, value.kind, value.name, value.sortOrder, value.logId, value.updatedAt);
    }
    case "food": {
      const value = record as FoodRecord;
      return db.prepare(
        `INSERT INTO foods (id, log_id, name, serving, category_id, calories, protein_grams, fiber_grams, price_cents, external_url, image_asset_id, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${revision}, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, serving = excluded.serving, category_id = excluded.category_id,
           calories = excluded.calories, protein_grams = excluded.protein_grams, fiber_grams = excluded.fiber_grams,
           price_cents = excluded.price_cents, external_url = excluded.external_url, image_asset_id = excluded.image_asset_id,
           revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE foods.log_id = excluded.log_id`,
      ).bind(
        value.id, value.logId, value.name, value.serving, value.categoryId, value.calories, value.proteinGrams,
        value.fiberGrams, value.priceCents, value.externalUrl, value.imageAssetId, value.logId, value.updatedAt,
      );
    }
    case "meal": {
      const value = record as MealRecord;
      return db.prepare(
        `INSERT INTO meals (id, log_id, eaten_at, items_json, image_asset_id, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ${revision}, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET eaten_at = excluded.eaten_at, items_json = excluded.items_json,
           image_asset_id = excluded.image_asset_id, revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE meals.log_id = excluded.log_id`,
      ).bind(value.id, value.logId, value.eatenAt, JSON.stringify(value.items), value.imageAssetId, value.logId, value.updatedAt);
    }
    case "activity": {
      const value = record as ActivityRecord;
      return db.prepare(
        `INSERT INTO activities (id, log_id, name, detail, category_id, external_url, image_asset_id, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${revision}, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, detail = excluded.detail, category_id = excluded.category_id,
           external_url = excluded.external_url, image_asset_id = excluded.image_asset_id,
           revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE activities.log_id = excluded.log_id`,
      ).bind(
        value.id, value.logId, value.name, value.detail, value.categoryId, value.externalUrl, value.imageAssetId,
        value.logId, value.updatedAt,
      );
    }
    case "exercise": {
      const value = record as ExerciseRecord;
      return db.prepare(
        `INSERT INTO exercise_entries (id, log_id, activity_id, text, performed_at, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ${revision}, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET activity_id = excluded.activity_id, text = excluded.text, performed_at = excluded.performed_at,
           revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE exercise_entries.log_id = excluded.log_id`,
      ).bind(value.id, value.logId, value.activityId, value.text, value.performedAt, value.logId, value.updatedAt);
    }
    case "checklistItem": {
      const value = record as ChecklistItemRecord;
      return db.prepare(
        `INSERT INTO checklist_items (id, log_id, name, cadence, external_url, image_asset_id, sort_order, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${revision}, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, cadence = excluded.cadence, external_url = excluded.external_url,
           image_asset_id = excluded.image_asset_id, sort_order = excluded.sort_order,
           revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE checklist_items.log_id = excluded.log_id`,
      ).bind(
        value.id, value.logId, value.name, value.cadence, value.externalUrl, value.imageAssetId, value.sortOrder,
        value.logId, value.updatedAt,
      );
    }
    case "checklistCompletion": {
      const value = record as ChecklistCompletionRecord;
      return db.prepare(
        `INSERT INTO checklist_completions (id, log_id, checklist_item_id, period_key, completed_at, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ${revision}, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET checklist_item_id = excluded.checklist_item_id, period_key = excluded.period_key,
           completed_at = excluded.completed_at, revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE checklist_completions.log_id = excluded.log_id`,
      ).bind(
        value.id, value.logId, value.checklistItemId, value.periodKey, value.completedAt, value.logId, value.updatedAt,
      );
    }
    case "groceryItem": {
      const value = record as GroceryItemRecord;
      return db.prepare(
        `INSERT INTO grocery_items (id, log_id, food_id, name, in_cart, external_url, image_asset_id, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${revision}, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET food_id = excluded.food_id, name = excluded.name, in_cart = excluded.in_cart,
           external_url = excluded.external_url, image_asset_id = excluded.image_asset_id,
           revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE grocery_items.log_id = excluded.log_id`,
      ).bind(
        value.id, value.logId, value.foodId, value.name, value.inCart ? 1 : 0, value.externalUrl, value.imageAssetId,
        value.logId, value.updatedAt,
      );
    }
  }
}

function recordFromRow(entity: DailyLogEntity, row: Record<string, unknown>): DailyLogRecord {
  const common = {
    id: String(row.id),
    logId: String(row.log_id) as LogId,
    revision: asNumber(row.revision),
    updatedAt: asNumber(row.updated_at) as EpochMs,
    deletedAt: asNullableNumber(row.deleted_at) as EpochMs | null,
  };
  switch (entity) {
    case "category": return {
      ...common,
      id: common.id as CategoryRecord["id"],
      kind: row.kind as CategoryRecord["kind"],
      name: String(row.name),
      sortOrder: asNumber(row.sort_order),
    };
    case "food": return {
      ...common,
      id: common.id as FoodRecord["id"],
      name: String(row.name),
      serving: String(row.serving),
      categoryId: row.category_id === null ? null : String(row.category_id) as FoodRecord["categoryId"],
      calories: asNumber(row.calories),
      proteinGrams: asNullableNumber(row.protein_grams),
      fiberGrams: asNullableNumber(row.fiber_grams),
      priceCents: asNullableNumber(row.price_cents),
      externalUrl: row.external_url === null ? null : String(row.external_url),
      imageAssetId: row.image_asset_id === null ? null : String(row.image_asset_id) as FoodRecord["imageAssetId"],
    };
    case "meal": return {
      ...common,
      id: common.id as MealRecord["id"],
      eatenAt: asNumber(row.eaten_at) as EpochMs,
      items: JSON.parse(String(row.items_json)) as MealRecord["items"],
      imageAssetId: row.image_asset_id === null ? null : String(row.image_asset_id) as MealRecord["imageAssetId"],
    };
    case "activity": return {
      ...common,
      id: common.id as ActivityRecord["id"],
      name: String(row.name),
      detail: String(row.detail),
      categoryId: row.category_id === null ? null : String(row.category_id) as ActivityRecord["categoryId"],
      externalUrl: row.external_url === null ? null : String(row.external_url),
      imageAssetId: row.image_asset_id === null ? null : String(row.image_asset_id) as ActivityRecord["imageAssetId"],
    };
    case "exercise": return {
      ...common,
      id: common.id as ExerciseRecord["id"],
      activityId: row.activity_id === null ? null : String(row.activity_id) as ExerciseRecord["activityId"],
      text: String(row.text),
      performedAt: asNumber(row.performed_at) as EpochMs,
    };
    case "checklistItem": return {
      ...common,
      id: common.id as ChecklistItemRecord["id"],
      name: String(row.name),
      cadence: row.cadence as ChecklistItemRecord["cadence"],
      externalUrl: row.external_url === null ? null : String(row.external_url),
      imageAssetId: row.image_asset_id === null ? null : String(row.image_asset_id) as ChecklistItemRecord["imageAssetId"],
      sortOrder: asNumber(row.sort_order),
    };
    case "checklistCompletion": return {
      ...common,
      id: common.id as ChecklistCompletionRecord["id"],
      checklistItemId: String(row.checklist_item_id) as ChecklistCompletionRecord["checklistItemId"],
      periodKey: String(row.period_key) as ChecklistCompletionRecord["periodKey"],
      completedAt: asNumber(row.completed_at) as EpochMs,
    };
    case "groceryItem": return {
      ...common,
      id: common.id as GroceryItemRecord["id"],
      foodId: row.food_id === null ? null : String(row.food_id) as GroceryItemRecord["foodId"],
      name: String(row.name),
      inCart: asNumber(row.in_cart) === 1,
      externalUrl: row.external_url === null ? null : String(row.external_url),
      imageAssetId: row.image_asset_id === null ? null : String(row.image_asset_id) as GroceryItemRecord["imageAssetId"],
    };
  }
}

function scheduleImageDeletion(db: D1Database, assetId: string, logId: LogId, now: number): D1PreparedStatement {
  return db.prepare(
    `UPDATE image_assets SET status = 'pending_delete', delete_after = ?, updated_at = ?
     WHERE id = ? AND log_id = ?
       AND NOT EXISTS (SELECT 1 FROM foods WHERE log_id = ? AND image_asset_id = ? AND deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM meals WHERE log_id = ? AND image_asset_id = ? AND deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM activities WHERE log_id = ? AND image_asset_id = ? AND deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM checklist_items WHERE log_id = ? AND image_asset_id = ? AND deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM grocery_items WHERE log_id = ? AND image_asset_id = ? AND deleted_at IS NULL)`,
  ).bind(
    now + 24 * 60 * 60 * 1_000, now, assetId, logId,
    logId, assetId, logId, assetId, logId, assetId, logId, assetId, logId, assetId,
  );
}

export class DailyLogRepository {
  constructor(private readonly db: D1Database) {}

  private async requireOwnedReference(
    table: string,
    id: string | null,
    logId: LogId,
    extraSql = "",
    extraBindings: unknown[] = [],
  ): Promise<void> {
    if (id === null) return;
    const row = await this.db.prepare(
      `SELECT 1 AS present FROM ${table} WHERE id = ? AND log_id = ? AND deleted_at IS NULL ${extraSql}`,
    ).bind(id, logId, ...extraBindings).first<{ present: number }>();
    if (!row) throw new RepositoryError("validation_failure", "A linked record is missing or belongs to another log.");
  }

  private async validateReferences(entity: DailyLogEntity, record: DailyLogRecord, logId: LogId): Promise<void> {
    if ("imageAssetId" in record && record.imageAssetId !== null) {
      const asset = await this.db.prepare("SELECT 1 AS present FROM image_assets WHERE id = ? AND log_id = ? AND status IN ('uploaded', 'attached')")
        .bind(record.imageAssetId, logId).first<{ present: number }>();
      if (!asset) throw new RepositoryError("validation_failure", "Image is missing or belongs to another log.");
    }
    switch (entity) {
      case "food":
        return this.requireOwnedReference("categories", (record as FoodRecord).categoryId, logId, "AND kind = ?", ["food"]);
      case "activity":
        return this.requireOwnedReference("categories", (record as ActivityRecord).categoryId, logId, "AND kind = ?", ["activity"]);
      case "exercise":
        return this.requireOwnedReference("activities", (record as ExerciseRecord).activityId, logId);
      case "checklistCompletion":
        return this.requireOwnedReference("checklist_items", (record as ChecklistCompletionRecord).checklistItemId, logId);
      case "groceryItem":
        return this.requireOwnedReference("foods", (record as GroceryItemRecord).foodId, logId);
      default:
        return;
    }
  }

  async save(
    logId: LogId,
    entity: DailyLogEntity,
    payload: unknown,
    now: EpochMs,
    mutationId?: MutationId,
  ): Promise<number> {
    const record = validateRecord(entity, payload, logId, now);
    await this.validateReferences(entity, record, logId);
    const oldImage = "imageAssetId" in record
      ? await this.db.prepare(`SELECT image_asset_id FROM ${tableName(entity)} WHERE id = ? AND log_id = ?`).bind(record.id, logId).first<string>("image_asset_id")
      : null;
    const newImage = "imageAssetId" in record ? record.imageAssetId : null;
    const imageStatements: D1PreparedStatement[] = [];
    if (newImage) imageStatements.push(this.db.prepare("UPDATE image_assets SET status = 'attached', delete_after = NULL, updated_at = ? WHERE id = ? AND log_id = ?").bind(now, newImage, logId));
    if (oldImage && oldImage !== newImage) imageStatements.push(scheduleImageDeletion(this.db, oldImage, logId, now));
    return commitRevisionChange(this.db, logId, saveStatement(this.db, entity, record), {
      entityType: entity,
      entityId: record.id,
      operation: "upsert",
      payload: record,
      createdAt: now,
      mutationId,
    }, imageStatements);
  }

  async delete(
    logId: LogId,
    entity: DailyLogEntity,
    entityId: string,
    now: EpochMs,
    mutationId?: MutationId,
    replacementCategoryId?: CategoryId,
  ): Promise<number> {
    const table = tableName(entity);
    const oldImage = ["food", "meal", "activity", "checklistItem", "groceryItem"].includes(entity)
      ? await this.db.prepare(`SELECT image_asset_id FROM ${table} WHERE id = ? AND log_id = ?`).bind(entityId, logId).first<string>("image_asset_id")
      : null;
    const additional: D1PreparedStatement[] = [];
    if (oldImage) additional.push(scheduleImageDeletion(this.db, oldImage, logId, now));
    if (entity === "category") {
      if (!replacementCategoryId) throw new RepositoryError("validation_failure", "A replacement category is required.");
      const current = await this.db.prepare("SELECT kind FROM categories WHERE id = ? AND log_id = ? AND deleted_at IS NULL")
        .bind(entityId, logId).first<{ kind: string }>();
      const replacement = await this.db.prepare("SELECT kind FROM categories WHERE id = ? AND log_id = ? AND deleted_at IS NULL")
        .bind(replacementCategoryId, logId).first<{ kind: string }>();
      if (!current || !replacement || current.kind !== replacement.kind || entityId === replacementCategoryId) {
        throw new RepositoryError("validation_failure", "Replacement category is invalid.");
      }
      const linkedTable = current.kind === "food" ? "foods" : "activities";
      additional.push(this.db.prepare(
        `UPDATE ${linkedTable} SET category_id = ?, revision = (SELECT revision FROM logs WHERE id = ?), updated_at = ?
         WHERE log_id = ? AND category_id = ? AND deleted_at IS NULL`,
      ).bind(replacementCategoryId, logId, now, logId, entityId));
    } else if (entity === "checklistItem") {
      additional.push(this.db.prepare(
        `UPDATE checklist_completions
         SET deleted_at = ?, revision = (SELECT revision FROM logs WHERE id = ?), updated_at = ?
         WHERE log_id = ? AND checklist_item_id = ? AND deleted_at IS NULL`,
      ).bind(now, logId, now, logId, entityId));
    } else if (entity === "food") {
      additional.push(this.db.prepare(
        "UPDATE grocery_items SET food_id = NULL, revision = (SELECT revision FROM logs WHERE id = ?), updated_at = ? WHERE log_id = ? AND food_id = ?",
      ).bind(logId, now, logId, entityId));
    } else if (entity === "activity") {
      additional.push(this.db.prepare(
        "UPDATE exercise_entries SET activity_id = NULL, revision = (SELECT revision FROM logs WHERE id = ?), updated_at = ? WHERE log_id = ? AND activity_id = ?",
      ).bind(logId, now, logId, entityId));
    }
    const statement = this.db.prepare(
      `UPDATE ${table} SET deleted_at = ?, updated_at = ?, revision = (SELECT revision FROM logs WHERE id = ?)
       WHERE id = ? AND log_id = ?`,
    ).bind(now, now, logId, entityId, logId);
    return commitRevisionChange(this.db, logId, statement, {
      entityType: entity,
      entityId,
      operation: "delete",
      payload: entity === "category" ? { id: entityId, replacementCategoryId } : { id: entityId },
      createdAt: now,
      mutationId,
    }, additional);
  }

  async updateNutritionTargets(
    logId: LogId,
    payload: unknown,
    now: EpochMs,
    mutationId?: MutationId,
  ): Promise<number> {
    const checked = validateNutritionTargets(payload);
    if (!checked.ok) throw new RepositoryError("validation_failure", checked.message);
    const targets = checked.value;
    const statement = this.db.prepare(
      `UPDATE logs SET target_calories = ?, target_protein_grams = ?, target_fiber_grams = ? WHERE id = ?`,
    ).bind(targets.calories, targets.proteinGrams, targets.fiberGrams, logId);
    return commitRevisionChange(this.db, logId, statement, {
      entityType: "nutritionTargets",
      entityId: "active",
      operation: "upsert",
      payload: targets,
      createdAt: now,
      mutationId,
    });
  }

  async listEntity(logId: LogId, entity: DailyLogEntity): Promise<DailyLogRecord[]> {
    try {
      const result = await this.db.prepare(`SELECT * FROM ${tableName(entity)} WHERE log_id = ? AND deleted_at IS NULL ORDER BY revision`)
        .bind(logId).all<Record<string, unknown>>();
      return result.results.map((row) => recordFromRow(entity, row));
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async getNutritionTargets(logId: LogId): Promise<NutritionTargets> {
    const row = await this.db.prepare(
      "SELECT target_calories, target_protein_grams, target_fiber_grams FROM logs WHERE id = ?",
    ).bind(logId).first<Record<string, unknown>>();
    if (!row) throw new RepositoryError("not_found", "Log was not found.");
    return {
      calories: asNullableNumber(row.target_calories),
      proteinGrams: asNullableNumber(row.target_protein_grams),
      fiberGrams: asNullableNumber(row.target_fiber_grams),
    };
  }

  async loadSnapshot(logId: LogId): Promise<DailyLogSnapshot> {
    const lists = await Promise.all(ENTITIES.map((entity) => this.listEntity(logId, entity)));
    const nutritionTargets = await this.getNutritionTargets(logId);
    return {
      categories: lists[0] as CategoryRecord[],
      foods: lists[1] as FoodRecord[],
      meals: lists[2] as MealRecord[],
      activities: lists[3] as ActivityRecord[],
      exercise: lists[4] as ExerciseRecord[],
      checklistItems: lists[5] as ChecklistItemRecord[],
      checklistCompletions: lists[6] as ChecklistCompletionRecord[],
      groceryItems: lists[7] as GroceryItemRecord[],
      nutritionTargets,
    };
  }
}
