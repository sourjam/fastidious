import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DeviceId, EpochMs, FastId, FoodId, IanaTimezone, LogId, MutationId, WeightId } from "../../domain/types";
import { digestSecret, isCanonicalSecret } from "../crypto.server";
import { createLog as createIdentityLog } from "../identity.server";
import { synchronize } from "../sync.server";
import type { SyncRequest } from "../../sync/contract";
import { notificationStatementsForFast } from "../../notifications/jobs.server";
import { sendDueNotifications } from "../../notifications/scheduled.server";
import { expireInactiveLogs } from "../../expiration/cleanup.server";
import { cleanupPendingImages, ImageUploadError, uploadOwnedImage } from "../images.server";
import { ChangeRepository } from "./changes.server";
import { DailyLogRepository } from "./daily-log.server";
import { ImageAssetRepository } from "./images.server";
import { FastRepository } from "./fasts.server";
import { LogRepository } from "./logs.server";
import { MutationRepository } from "./mutations.server";
import { PushRepository } from "./push.server";
import { WeightRepository } from "./weights.server";

class SqliteD1Statement {
  private values: SQLInputValue[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): SqliteD1Statement {
    const bound = new SqliteD1Statement(this.sqlite, this.sql);
    bound.values = values as SQLInputValue[];
    return bound;
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column === undefined ? row : row[column]) as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.sqlite.prepare(this.sql);
    statement.setReturnArrays(true);
    return statement.all(...this.values) as T[];
  }

  execute<T = Record<string, unknown>>(): D1Result<T> {
    const statement = this.sqlite.prepare(this.sql);
    if (/^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(this.sql)) {
      return {
        success: true,
        results: statement.all(...this.values) as T[],
        meta: { changes: 0 },
      } as D1Result<T>;
    }
    const result = statement.run(...this.values);
    return {
      success: true,
      results: [],
      meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) },
    } as unknown as D1Result<T>;
  }
}

function sqliteD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(sqlite, sql) as unknown as D1PreparedStatement;
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          (statement as unknown as SqliteD1Statement).execute<T>(),
        );
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as D1Database;
}

const LOG_ID = "10000000-0000-4000-8000-000000000001" as LogId;
const OTHER_LOG_ID = "10000000-0000-4000-8000-000000000002" as LogId;
const FAST_ID = "20000000-0000-4000-8000-000000000001" as FastId;
const OTHER_FAST_ID = "20000000-0000-4000-8000-000000000002" as FastId;
const WEIGHT_ID = "30000000-0000-4000-8000-000000000001" as WeightId;
const FOOD_ID = "60000000-0000-4000-8000-000000000001" as FoodId;
const MUTATION_ID = "40000000-0000-4000-8000-000000000001" as MutationId;
const OTHER_MUTATION_ID = "40000000-0000-4000-8000-000000000002" as MutationId;
const NOW = 100_000 as EpochMs;
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_TOKEN = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const DIGEST = "Zmh6rfhivXdsj8GLjp-OIAiXFIVu4jOzkCpZHQ1fKSU";
const OTHER_DIGEST = "cs1uhCLEB_ttCYaQ8RMLfe1-wvf14dML2dUh8BU2N5M";

let sqlite: DatabaseSync;
let db: D1Database;
let logs: LogRepository;
let fasts: FastRepository;
let weights: WeightRepository;
let changes: ChangeRepository;
let mutations: MutationRepository;

async function createLog(id = LOG_ID, digest = DIGEST, expiresAt = 1_000_000) {
  return logs.create({
    id,
    secretDigest: digest,
    preferences: {
      timezone: "America/New_York" as IanaTimezone,
      theme: "system",
      weightUnit: "kg",
      defaultGoalHours: 16,
    },
    now: NOW,
    expiresAt,
  });
}

function syncRequest(mutations: SyncRequest["mutations"], cursor = 0): SyncRequest {
  return {
    protocolVersion: 1,
    deviceId: "50000000-0000-4000-8000-000000000001" as SyncRequest["deviceId"],
    cursor,
    dataGeneration: 1,
    mutations,
  };
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0002_revoked_secrets.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0003_web_push.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0004_daily_log_v2.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0005_cloudflare_images.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0006_meal_images.sql", "utf8"));
  db = sqliteD1(sqlite);
  logs = new LogRepository(db);
  fasts = new FastRepository(db);
  weights = new WeightRepository(db);
  changes = new ChangeRepository(db);
  mutations = new MutationRepository(db);
});

afterEach(() => sqlite.close());

describe("D1 migration and repositories", () => {
  it("applies the complete migrations to an empty database", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([
      "activities",
      "categories",
      "changes",
      "checklist_completions",
      "checklist_items",
      "exercise_entries",
      "expired_logs",
      "fasts",
      "foods",
      "grocery_items",
      "image_assets",
      "logs",
      "meals",
      "mutation_receipts",
      "notification_jobs",
      "push_subscriptions",
      "revoked_secrets",
      "weights",
    ]);
  });

  it("creates a log with only its digest persisted and returns a canonical secret", async () => {
    const created = await createIdentityLog(db, { timezone: "UTC", weightUnit: "kg" }, undefined, NOW);
    const row = sqlite.prepare("SELECT secret_digest FROM logs WHERE id = ?").get(created.snapshot.logId) as { secret_digest: string };

    expect(isCanonicalSecret(created.secret)).toBe(true);
    expect(row.secret_digest).toBe(await digestSecret(created.secret));
    expect(row.secret_digest).not.toBe(created.secret);
  });

  it("authenticates only the matching secret digest and coalesces a 12-calendar-month expiration touch", async () => {
    const digest = await digestSecret(TOKEN);
    const leapDay = Date.UTC(2024, 1, 29, 12);
    await logs.create({
      id: LOG_ID,
      secretDigest: digest,
      preferences: { timezone: "UTC" as IanaTimezone, theme: "system", weightUnit: "kg", defaultGoalHours: 16 },
      now: leapDay,
    });
    await expect(
      logs.authenticateAndTouch(await digestSecret(OTHER_TOKEN), leapDay + 1),
    ).rejects.toMatchObject({ code: "unauthorized" });
    const coalesced = await logs.authenticateAndTouch(digest, leapDay + 1);
    expect(coalesced.lastAccessAt).toBe(leapDay);
    const touchedAt = leapDay + 3_600_001;
    const authenticated = await logs.authenticateAndTouch(digest, touchedAt);
    expect(authenticated).toMatchObject({
      id: LOG_ID,
      lastAccessAt: touchedAt,
      expiresAt: Date.UTC(2025, 1, 28, 13, 0, 0, 1),
    });
  });

  it("atomically rotates a secret and reports the old credential as revoked", async () => {
    const oldDigest = await digestSecret(TOKEN);
    const newDigest = await digestSecret(OTHER_TOKEN);
    await createLog(LOG_ID, oldDigest, NOW + 10_000_000);

    const rotated = await logs.rotateDigest(LOG_ID, newDigest, 1, NOW + 1);

    expect(rotated.credentialGeneration).toBe(2);
    await expect(logs.authenticateAndTouch(oldDigest, NOW + 2)).rejects.toMatchObject({ code: "revoked" });
    await expect(logs.authenticateAndTouch(newDigest, NOW + 2)).resolves.toMatchObject({ id: LOG_ID });
  });

  it("applies a retried food mutation exactly once", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    const mutation = {
      id: MUTATION_ID,
      sequence: 1,
      entity: "food" as const,
      operation: "upsert",
      payload: {
        id: FOOD_ID,
        name: "Black beans",
        serving: "1 can",
        categoryId: null,
        calories: 395,
        proteinGrams: 17.5,
        fiberGrams: 10.5,
        priceCents: 199,
        externalUrl: null,
        imageAssetId: null,
      },
      dataGeneration: 1,
    };

    const first = await synchronize(db, { log }, syncRequest([mutation]), NOW + 1);
    const retry = await synchronize(db, { log }, syncRequest([mutation]), NOW + 2);

    expect(first.acknowledgedMutationIds).toEqual([MUTATION_ID]);
    expect(retry.acknowledgedMutationIds).toEqual([MUTATION_ID]);
    expect((await logs.get(LOG_ID))?.revision).toBe(1);
    expect(first.changes).toMatchObject([{ entityType: "food", record: { id: FOOD_ID, calories: 395 } }]);
  });

  it("applies a retried sync mutation exactly once", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    const mutation = {
      id: MUTATION_ID,
      sequence: 1,
      entity: "fast" as const,
      operation: "upsert",
      payload: { id: FAST_ID, startAt: 1_000, endAt: 2_000, goalHours: 16 },
      dataGeneration: 1,
    };

    const first = await synchronize(db, { log }, syncRequest([mutation]), NOW + 1);
    const retry = await synchronize(db, { log }, syncRequest([mutation]), NOW + 2);

    expect(first.acknowledgedMutationIds).toEqual([MUTATION_ID]);
    expect(retry.acknowledgedMutationIds).toEqual([MUTATION_ID]);
    expect((await logs.get(LOG_ID))?.revision).toBe(1);
    expect(await fasts.listSnapshot(LOG_ID)).toHaveLength(1);
  });

  it("atomically replaces data and advances the generation", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    await fasts.save({ id: FAST_ID, logId: LOG_ID, startAt: 1_000 as EpochMs, endAt: 2_000 as EpochMs, goalHours: 16, now: NOW });
    const request = syncRequest([{
      id: MUTATION_ID,
      sequence: 1,
      entity: "data",
      operation: "replace",
      dataGeneration: 2,
      payload: {
        preferences: { timezone: "Europe/Paris", theme: "dark", weightUnit: "lb", defaultGoalHours: 18 },
        fasts: [],
        weights: [{
          id: WEIGHT_ID,
          logId: LOG_ID,
          measuredAt: 3_000,
          kilograms: 70,
          revision: 0,
          updatedAt: 3_000,
          deletedAt: null,
        }],
      },
    }]);
    request.dataGeneration = 2;

    const result = await synchronize(db, { log }, request, NOW + 1);

    expect(result).toMatchObject({ dataGeneration: 2, acknowledgedMutationIds: [MUTATION_ID] });
    expect(await fasts.listSnapshot(LOG_ID)).toEqual([]);
    expect(await weights.listSnapshot(LOG_ID)).toMatchObject([{ id: WEIGHT_ID, kilograms: 70 }]);
    expect(await logs.get(LOG_ID)).toMatchObject({ dataGeneration: 2, preferences: { timezone: "Europe/Paris", theme: "dark" } });
  });

  it("deletes a category and reassigns its foods atomically", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    const categoryId = "61000000-0000-4000-8000-000000000001";
    const otherCategoryId = "61000000-0000-4000-8000-000000000002";
    const base = { dataGeneration: 1 };
    await synchronize(db, { log }, syncRequest([
      {
        ...base,
        id: MUTATION_ID,
        sequence: 1,
        entity: "category",
        operation: "upsert",
        payload: { id: categoryId, kind: "food", name: "Pantry", sortOrder: 0 },
      },
      {
        ...base,
        id: OTHER_MUTATION_ID,
        sequence: 2,
        entity: "category",
        operation: "upsert",
        payload: { id: otherCategoryId, kind: "food", name: "Other", sortOrder: 1 },
      },
      {
        ...base,
        id: "40000000-0000-4000-8000-000000000003" as MutationId,
        sequence: 3,
        entity: "food",
        operation: "upsert",
        payload: {
          id: FOOD_ID,
          name: "Beans",
          serving: "1 can",
          categoryId,
          calories: 395,
          proteinGrams: null,
          fiberGrams: null,
          priceCents: null,
          externalUrl: null,
          imageAssetId: null,
        },
      },
    ]), NOW + 1);

    const deletion = await synchronize(db, { log }, syncRequest([{
      id: "40000000-0000-4000-8000-000000000004" as MutationId,
      sequence: 1,
      entity: "category",
      operation: "delete",
      payload: { id: categoryId, replacementCategoryId: otherCategoryId },
      dataGeneration: 1,
    }]), NOW + 2);

    const daily = await new DailyLogRepository(db).loadSnapshot(LOG_ID);
    expect(deletion.changes.at(-1)).toMatchObject({
      entityType: "category",
      entityId: categoryId,
      record: null,
      replacementCategoryId: otherCategoryId,
    });
    expect(daily.categories.map((category) => category.id)).toEqual([otherCategoryId]);
    expect(daily.foods).toMatchObject([{ id: FOOD_ID, categoryId: otherCategoryId }]);
  });

  it("replaces v2 daily-log rows and nutrition targets in one generation reset", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    const mealId = "70000000-0000-4000-8000-000000000001";
    const request = syncRequest([{
      id: MUTATION_ID,
      sequence: 1,
      entity: "data",
      operation: "replace",
      dataGeneration: 2,
      payload: {
        preferences: { timezone: "UTC", theme: "system", weightUnit: "kg", defaultGoalHours: 16 },
        fasts: [],
        weights: [],
        categories: [],
        foods: [],
        meals: [{
          id: mealId,
          logId: LOG_ID,
          eatenAt: 1_000,
          items: [{
            foodId: null,
            name: "Soup",
            quantity: 1,
            caloriesPerServing: 250,
            proteinGramsPerServing: 8,
            fiberGramsPerServing: 4,
          }],
          imageAssetId: null,
          revision: 0,
          updatedAt: 1_000,
          deletedAt: null,
        }],
        activities: [],
        exercise: [],
        checklistItems: [],
        checklistCompletions: [],
        groceryItems: [],
        nutritionTargets: { calories: 2_000, proteinGrams: null, fiberGrams: 30 },
      },
    }]);
    request.dataGeneration = 2;

    await synchronize(db, { log }, request, NOW + 1);
    const daily = await new DailyLogRepository(db).loadSnapshot(LOG_ID);

    expect(daily.meals).toMatchObject([{ id: mealId, items: [{ name: "Soup" }] }]);
    expect(daily.nutritionTargets).toEqual({ calories: 2_000, proteinGrams: null, fiberGrams: 30 });
  });

  it("clears v2 server rows and targets during a generation reset", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    const dailyLog = new DailyLogRepository(db);
    await dailyLog.save(LOG_ID, "food", {
      id: FOOD_ID,
      name: "Beans",
      serving: "1 can",
      categoryId: null,
      calories: 395,
      proteinGrams: null,
      fiberGrams: null,
      priceCents: null,
      externalUrl: null,
      imageAssetId: null,
    }, NOW);
    await dailyLog.updateNutritionTargets(LOG_ID, { calories: 2_000, proteinGrams: null, fiberGrams: 30 }, NOW);
    const request = syncRequest([{
      id: MUTATION_ID,
      sequence: 1,
      entity: "data",
      operation: "clear",
      payload: {},
      dataGeneration: 2,
    }]);
    request.dataGeneration = 2;

    await synchronize(db, { log }, request, NOW + 1);
    const snapshot = await dailyLog.loadSnapshot(LOG_ID);

    expect(snapshot.foods).toEqual([]);
    expect(snapshot.nutritionTargets).toEqual({ calories: null, proteinGrams: null, fiberGrams: null });
  });

  it("keeps separate records and resolves one record by last server arrival", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    await synchronize(db, { log }, syncRequest([{
      id: MUTATION_ID,
      sequence: 1,
      entity: "weight",
      operation: "upsert",
      payload: { id: WEIGHT_ID, measuredAt: 1_000, kilograms: 70 },
      dataGeneration: 1,
    }]), NOW + 1);
    await synchronize(db, { log }, syncRequest([{
      id: OTHER_MUTATION_ID,
      sequence: 1,
      entity: "weight",
      operation: "upsert",
      payload: { id: OTHER_FAST_ID, measuredAt: 2_000, kilograms: 80 },
      dataGeneration: 1,
    }]), NOW + 2);
    await synchronize(db, { log }, syncRequest([{
      id: "40000000-0000-4000-8000-000000000003" as MutationId,
      sequence: 1,
      entity: "weight",
      operation: "upsert",
      payload: { id: WEIGHT_ID, measuredAt: 1_000, kilograms: 71 },
      dataGeneration: 1,
    }]), NOW + 3);

    const records = await weights.listSnapshot(LOG_ID);
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.id === WEIGHT_ID)?.kilograms).toBe(71);
  });

  it("merges preference fields changed by separate devices", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    await synchronize(db, { log }, syncRequest([{
      id: MUTATION_ID,
      sequence: 1,
      entity: "preferences",
      operation: "update",
      payload: { theme: "dark" },
      dataGeneration: 1,
    }]), NOW + 1);
    await synchronize(db, { log }, syncRequest([{
      id: OTHER_MUTATION_ID,
      sequence: 1,
      entity: "preferences",
      operation: "update",
      payload: { timezone: "Europe/Paris" },
      dataGeneration: 1,
    }]), NOW + 2);

    expect((await logs.get(LOG_ID))?.preferences).toMatchObject({ theme: "dark", timezone: "Europe/Paris" });
  });

  it("makes the last accepted competing fast active and emits both changes", async () => {
    const log = await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    await synchronize(db, { log }, syncRequest([{
      id: MUTATION_ID,
      sequence: 1,
      entity: "fast",
      operation: "start",
      payload: { id: FAST_ID, startAt: 1_000, endAt: null, goalHours: 16 },
      dataGeneration: 1,
    }]), NOW + 1);

    const result = await synchronize(db, { log }, syncRequest([{
      id: OTHER_MUTATION_ID,
      sequence: 1,
      entity: "fast",
      operation: "start",
      payload: { id: OTHER_FAST_ID, startAt: 2_000, endAt: null, goalHours: 18 },
      dataGeneration: 1,
    }], 1), NOW + 2);

    expect((await fasts.active(LOG_ID))?.id).toBe(OTHER_FAST_ID);
    expect(result.changes.map((change) => [change.entityId, change.record])).toEqual([
      [FAST_ID, null],
      [OTHER_FAST_ID, expect.objectContaining({ id: OTHER_FAST_ID })],
    ]);
  });

  it("keeps duplicate mutation receipts idempotent", async () => {
    await createLog();
    const first = await mutations.record(LOG_ID, MUTATION_ID, 3, NOW);
    const duplicate = await mutations.record(LOG_ID, MUTATION_ID, 9, NOW + 1);
    expect(duplicate).toEqual(first);
  });

  it("applies mutation batches in order and skips a receipted retry", async () => {
    await createLog();
    const batch = [
      { mutationId: MUTATION_ID, id: FAST_ID, startAt: 1_000 as EpochMs, endAt: 2_000 as EpochMs },
      { mutationId: OTHER_MUTATION_ID, id: OTHER_FAST_ID, startAt: 3_000 as EpochMs, endAt: 4_000 as EpochMs },
    ];
    const apply = (mutation: (typeof batch)[number]) =>
      fasts
        .save({
          id: mutation.id,
          logId: LOG_ID,
          startAt: mutation.startAt,
          endAt: mutation.endAt,
          goalHours: 16,
          now: NOW,
          mutationId: mutation.mutationId,
        })
        .then((fast) => fast.revision);
    await expect(mutations.applyBatch(LOG_ID, batch, apply)).resolves.toEqual([
      { mutationId: MUTATION_ID, appliedRevision: 1, duplicate: false },
      { mutationId: OTHER_MUTATION_ID, appliedRevision: 2, duplicate: false },
    ]);
    await expect(mutations.applyBatch(LOG_ID, [batch[0]!], apply)).resolves.toEqual([
      { mutationId: MUTATION_ID, appliedRevision: 1, duplicate: true },
    ]);
  });

  it("advances the log revision, entity, change, and receipt together", async () => {
    await createLog();
    const fast = await fasts.save({
      id: FAST_ID,
      logId: LOG_ID,
      startAt: 1_000 as EpochMs,
      endAt: 2_000 as EpochMs,
      goalHours: 16,
      now: NOW,
      mutationId: MUTATION_ID,
    });
    const log = await logs.get(LOG_ID);
    const delta = await changes.fetchAfter(LOG_ID, 0);
    const receipt = await mutations.find(LOG_ID, MUTATION_ID);
    expect({ fastRevision: fast.revision, logRevision: log?.revision, changeRevision: delta[0]?.revision }).toEqual({
      fastRevision: 1,
      logRevision: 1,
      changeRevision: 1,
    });
    expect(receipt?.appliedRevision).toBe(1);
  });

  it("rejects a second active fast", async () => {
    await createLog();
    await fasts.save({ id: FAST_ID, logId: LOG_ID, startAt: 1_000 as EpochMs, endAt: null, goalHours: 16, now: NOW });
    await expect(
      fasts.save({ id: OTHER_FAST_ID, logId: LOG_ID, startAt: 2_000 as EpochMs, endAt: null, goalHours: 16, now: NOW }),
    ).rejects.toMatchObject({ code: "active_fast_conflict" });
    await expect(fasts.active(LOG_ID)).resolves.toMatchObject({ id: FAST_ID });
  });

  it("rejects overlapping completed intervals", async () => {
    await createLog();
    await fasts.save({
      id: FAST_ID,
      logId: LOG_ID,
      startAt: 1_000 as EpochMs,
      endAt: 5_000 as EpochMs,
      goalHours: 16,
      now: NOW,
    });
    await expect(
      fasts.save({
        id: OTHER_FAST_ID,
        logId: LOG_ID,
        startAt: 4_000 as EpochMs,
        endAt: 6_000 as EpochMs,
        goalHours: 16,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "overlap" });
  });

  it("creates a tombstone and change when deleting an entity", async () => {
    await createLog();
    await fasts.save({
      id: FAST_ID,
      logId: LOG_ID,
      startAt: 1_000 as EpochMs,
      endAt: 2_000 as EpochMs,
      goalHours: 16,
      now: NOW,
    });
    const deleted = await fasts.delete(LOG_ID, FAST_ID, (NOW + 1) as EpochMs);
    const delta = await changes.fetchAfter(LOG_ID, 1);
    expect(deleted).toMatchObject({ revision: 2, deletedAt: NOW + 1 });
    expect(delta).toEqual([
      expect.objectContaining({ revision: 2, entityType: "fast", entityId: FAST_ID, operation: "delete" }),
    ]);
  });

  it("stores canonical weights and tombstones their deletion", async () => {
    await createLog();
    const weight = await weights.save({
      id: WEIGHT_ID,
      logId: LOG_ID,
      measuredAt: 1_000 as EpochMs,
      kilograms: 72.5,
      now: NOW,
    });
    const deleted = await weights.delete(LOG_ID, WEIGHT_ID, (NOW + 1) as EpochMs);
    expect(weight).toMatchObject({ kilograms: 72.5, revision: 1 });
    expect(deleted).toMatchObject({ deletedAt: NOW + 1, revision: 2 });
  });

  it("increments data generation with its revision journal entry", async () => {
    await createLog();
    const updated = await logs.incrementDataGeneration(LOG_ID, NOW + 1);
    const delta = await changes.fetchAfter(LOG_ID, 0);
    expect(updated).toMatchObject({ dataGeneration: 2, revision: 1 });
    expect(delta).toEqual([
      expect.objectContaining({
        revision: 1,
        entityType: "generation",
        operation: "reset",
        payload: { dataGeneration: 2 },
      }),
    ]);
  });

  it("returns only logs due for expiration", async () => {
    await createLog(LOG_ID, DIGEST, NOW + 10);
    await createLog(OTHER_LOG_ID, OTHER_DIGEST, NOW + 20);
    await expect(logs.listDueForExpiration(NOW + 10)).resolves.toEqual([
      expect.objectContaining({ id: LOG_ID }),
    ]);
  });

  it("normalizes an image upload once and returns the same asset for a retried upload key", async () => {
    await createLog();
    let uploads = 0;
    const metadata = { id: "asset_1234567890123456", filename: "fastidious.webp", uploaded: new Date(), requireSignedURLs: true, variants: [] };
    const output = { response: () => new Response(new Blob(["normalized"])), contentType: () => "image/webp", image: () => new Blob(["normalized"]).stream() };
    const transformer = { transform: () => transformer, draw: () => transformer, output: async () => output };
    const images = {
      info: async () => ({ width: 40, height: 30, format: "image/jpeg", fileSize: 100 }),
      input: () => transformer,
      hosted: {
        list: async () => ({ images: [], listComplete: true }),
        upload: async () => { uploads += 1; return metadata; },
      },
    } as unknown as ImagesBinding;
    const input = { db, images, logId: LOG_ID, uploadKey: "70000000-0000-4000-8000-000000000001", bytes: new TextEncoder().encode("jpeg").buffer as ArrayBuffer, mimeType: "image/jpeg", now: NOW };

    const first = await uploadOwnedImage(input);
    const retried = await uploadOwnedImage(input);

    expect(first.id).toBe(metadata.id);
    expect(retried.id).toBe(metadata.id);
    expect(uploads).toBe(1);
  });

  it("returns an actionable error when the per-log image quota is full", async () => {
    await createLog();
    const insert = sqlite.prepare("INSERT INTO image_assets (id, log_id, upload_key, status, width, height, byte_size, created_at, updated_at) VALUES (?, ?, ?, 'attached', 1, 1, 1, ?, ?)");
    for (let index = 0; index < 100; index += 1) insert.run(`asset_${String(index).padStart(16, "0")}`, LOG_ID, `key-${index}`, NOW, NOW);
    const images = {} as ImagesBinding;
    await expect(uploadOwnedImage({ db, images, logId: LOG_ID, uploadKey: "70000000-0000-4000-8000-000000000002", bytes: new Uint8Array([1]).buffer, mimeType: "image/jpeg", now: NOW }))
      .rejects.toEqual(new ImageUploadError("image_quota", "Image quota reached. Remove an image or try again later."));
  });

  it("attaches only owned image assets and schedules replaced images for deletion", async () => {
    await createLog();
    const dailyLog = new DailyLogRepository(db);
    const assetId = "asset_1234567890123456";
    sqlite.prepare("INSERT INTO image_assets (id, log_id, upload_key, status, width, height, byte_size, created_at, updated_at) VALUES (?, ?, ?, 'uploaded', 40, 40, 100, ?, ?)")
      .run(assetId, LOG_ID, "upload-key", NOW, NOW);
    const food = { id: FOOD_ID, name: "Beans", serving: "1 can", categoryId: null, calories: 395, proteinGrams: null, fiberGrams: null, priceCents: null, externalUrl: null, imageAssetId: assetId };
    await dailyLog.save(LOG_ID, "food", food, NOW);
    expect(sqlite.prepare("SELECT status FROM image_assets WHERE id = ?").get(assetId)).toEqual({ status: "attached" });

    await dailyLog.save(LOG_ID, "food", { ...food, imageAssetId: null }, (NOW + 1) as typeof NOW);
    expect(sqlite.prepare("SELECT status, delete_after FROM image_assets WHERE id = ?").get(assetId)).toEqual({ status: "pending_delete", delete_after: NOW + 1 + 86_400_000 });
    await expect(dailyLog.save(LOG_ID, "activity", { id: "65000000-0000-4000-8000-000000000001", name: "Walk", detail: "", categoryId: null, externalUrl: null, imageAssetId: "asset_9999999999999999" }, NOW)).rejects.toMatchObject({ code: "validation_failure" });
    await expect(new ImageAssetRepository(db).requireOwned("10000000-0000-4000-8000-000000000099" as LogId, assetId)).rejects.toMatchObject({ code: "not_found" });

    const mealAssetId = "asset_1234567890123458";
    sqlite.prepare("INSERT INTO image_assets (id, log_id, upload_key, status, width, height, byte_size, created_at, updated_at) VALUES (?, ?, ?, 'uploaded', 40, 40, 100, ?, ?)")
      .run(mealAssetId, LOG_ID, "meal-upload-key", NOW, NOW);
    await dailyLog.save(LOG_ID, "meal", {
      id: "70000000-0000-4000-8000-000000000003",
      eatenAt: NOW - 1,
      items: [{ foodId: null, name: "Soup", quantity: 1, caloriesPerServing: 250, proteinGramsPerServing: null, fiberGramsPerServing: null }],
      imageAssetId: mealAssetId,
    }, NOW);

    expect((await dailyLog.loadSnapshot(LOG_ID)).meals).toMatchObject([{ imageAssetId: mealAssetId }]);
    expect(sqlite.prepare("SELECT status FROM image_assets WHERE id = ?").get(mealAssetId)).toEqual({ status: "attached" });

    const replacementId = "asset_1234567890123459";
    sqlite.prepare("INSERT INTO image_assets (id, log_id, upload_key, status, width, height, byte_size, created_at, updated_at) VALUES (?, ?, ?, 'uploaded', 40, 40, 100, ?, ?)")
      .run(replacementId, LOG_ID, "meal-replacement-key", NOW, NOW);
    const meal = (await dailyLog.loadSnapshot(LOG_ID)).meals[0]!;
    await dailyLog.save(LOG_ID, "meal", { ...meal, imageAssetId: replacementId }, (NOW + 2) as typeof NOW);
    expect(sqlite.prepare("SELECT status FROM image_assets WHERE id = ?").get(mealAssetId)).toEqual({ status: "pending_delete" });
    expect(sqlite.prepare("SELECT status FROM image_assets WHERE id = ?").get(replacementId)).toEqual({ status: "attached" });

    await dailyLog.save(LOG_ID, "meal", { ...meal, imageAssetId: null }, (NOW + 3) as typeof NOW);
    expect(sqlite.prepare("SELECT status FROM image_assets WHERE id = ?").get(replacementId)).toEqual({ status: "pending_delete" });
  });

  it("expires a bounded batch completely and idempotently, then purges old markers", async () => {
    await createLog(LOG_ID, DIGEST, NOW + 1);
    const push = new PushRepository(db);
    await push.upsertSubscription({
      id: "60000000-0000-4000-8000-000000000001",
      logId: LOG_ID,
      deviceId: "50000000-0000-4000-8000-000000000001" as DeviceId,
      endpoint: "https://push.example/subscription",
      p256dh: "key",
      auth: "auth",
      enabled: true,
      advanceEnabled: true,
      advanceMinutes: 30,
      goalEnabled: true,
      now: NOW,
    });
    await fasts.save(
      { id: FAST_ID, logId: LOG_ID, startAt: NOW, endAt: null, goalHours: 16, now: NOW },
      notificationStatementsForFast(db, { logId: LOG_ID, fastId: FAST_ID, startAt: NOW, endAt: null, goalHours: 16, now: NOW }),
    );
    await weights.save({ id: WEIGHT_ID, logId: LOG_ID, measuredAt: NOW, kilograms: 70, now: NOW });
    const dailyLog = new DailyLogRepository(db);
    const categoryId = "61000000-0000-4000-8000-000000000001";
    await dailyLog.save(LOG_ID, "category", { id: categoryId, kind: "food", name: "Other", sortOrder: 0 }, NOW);
    await dailyLog.save(LOG_ID, "food", {
      id: FOOD_ID,
      name: "Beans",
      serving: "1 can",
      categoryId,
      calories: 395,
      proteinGrams: null,
      fiberGrams: null,
      priceCents: null,
      externalUrl: null,
      imageAssetId: null,
    }, NOW);
    await mutations.record(LOG_ID, MUTATION_ID, 4, NOW);
    sqlite.prepare("INSERT INTO image_assets (id, log_id, upload_key, status, width, height, byte_size, created_at, updated_at) VALUES (?, ?, ?, 'attached', 40, 40, 100, ?, ?)")
      .run("asset_1234567890123456", LOG_ID, "expiration-upload", NOW, NOW);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM notification_jobs").get()).toEqual({ count: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM changes").get()).toEqual({ count: 4 });

    expect(await expireInactiveLogs(db, NOW + 1, 25, 10_000)).toEqual({ expired: 1, markersPurged: 0 });
    expect(await expireInactiveLogs(db, NOW + 1, 25, 10_000)).toEqual({ expired: 0, markersPurged: 0 });
    await expect(logs.authenticateAndTouch(DIGEST, NOW + 2)).rejects.toMatchObject({ code: "expired" });
    for (const table of [
      "logs", "fasts", "weights", "categories", "foods", "meals", "activities", "exercise_entries",
      "checklist_items", "checklist_completions", "grocery_items", "push_subscriptions", "notification_jobs",
      "mutation_receipts", "changes",
    ]) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
    expect(sqlite.prepare("SELECT digest_marker FROM expired_logs").all()).toEqual([{ digest_marker: DIGEST }]);
    expect(sqlite.prepare("SELECT log_id, status FROM image_assets").get()).toEqual({ log_id: null, status: "pending_delete" });
    const deleted: string[] = [];
    const images = { hosted: { image: (id: string) => ({ delete: async () => { deleted.push(id); return true; } }) } } as unknown as ImagesBinding;
    expect(await cleanupPendingImages(db, images, NOW + 1)).toBe(1);
    expect(deleted).toEqual(["asset_1234567890123456"]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM image_assets").get()).toEqual({ count: 0 });

    expect(await expireInactiveLogs(db, NOW + 10_002, 25, 10_000)).toEqual({ expired: 0, markersPurged: 1 });
    await expect(logs.authenticateAndTouch(DIGEST, NOW + 10_002)).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("sending push alone does not extend inactivity expiration", async () => {
    await createLog(LOG_ID, DIGEST, NOW + 10_000_000);
    await sendDueNotifications(db, async () => ({ status: 201 }), NOW);
    expect(await logs.get(LOG_ID)).toMatchObject({ lastAccessAt: NOW, expiresAt: NOW + 10_000_000 });
  });

  it("recalculates pending reminder times when an active goal changes and cancels them when it ends", async () => {
    await createLog();
    const push = new PushRepository(db);
    await push.upsertSubscription({
      id: "60000000-0000-4000-8000-000000000001",
      logId: LOG_ID,
      deviceId: "50000000-0000-4000-8000-000000000001" as DeviceId,
      endpoint: "https://push.example/subscription",
      p256dh: "key",
      auth: "auth",
      enabled: true,
      advanceEnabled: true,
      advanceMinutes: 30,
      goalEnabled: true,
      now: NOW,
    });
    await fasts.save({ id: FAST_ID, logId: LOG_ID, startAt: NOW, endAt: null, goalHours: 2, now: NOW },
      notificationStatementsForFast(db, { logId: LOG_ID, fastId: FAST_ID, startAt: NOW, endAt: null, goalHours: 2, now: NOW }));
    await fasts.save({ id: FAST_ID, logId: LOG_ID, startAt: NOW, endAt: null, goalHours: 3, now: (NOW + 1) as EpochMs },
      notificationStatementsForFast(db, { logId: LOG_ID, fastId: FAST_ID, startAt: NOW, endAt: null, goalHours: 3, now: NOW + 1 }));

    expect(sqlite.prepare("SELECT kind, due_at FROM notification_jobs ORDER BY kind").all()).toEqual([
      { kind: "advance", due_at: NOW + 2.5 * 3_600_000 },
      { kind: "goal", due_at: NOW + 3 * 3_600_000 },
    ]);

    await fasts.save({ id: FAST_ID, logId: LOG_ID, startAt: NOW, endAt: (NOW + 2) as EpochMs, goalHours: 3, now: (NOW + 2) as EpochMs },
      notificationStatementsForFast(db, { logId: LOG_ID, fastId: FAST_ID, endAt: NOW + 2, now: NOW + 2 }));
    expect(sqlite.prepare("SELECT DISTINCT status FROM notification_jobs").all()).toEqual([{ status: "cancelled" }]);
  });

  it("claims scheduled work idempotently and sends once after a transient retry", async () => {
    await createLog();
    const push = new PushRepository(db);
    await push.upsertSubscription({
      id: "60000000-0000-4000-8000-000000000001",
      logId: LOG_ID,
      deviceId: "50000000-0000-4000-8000-000000000001" as DeviceId,
      endpoint: "https://push.example/subscription",
      p256dh: "key",
      auth: "auth",
      enabled: true,
      advanceEnabled: true,
      advanceMinutes: 30,
      goalEnabled: true,
      now: NOW,
    });
    await fasts.save({ id: FAST_ID, logId: LOG_ID, startAt: NOW, endAt: null, goalHours: 2, now: NOW },
      notificationStatementsForFast(db, { logId: LOG_ID, fastId: FAST_ID, startAt: NOW, endAt: null, goalHours: 2, now: NOW }));
    sqlite.prepare("UPDATE notification_jobs SET due_at = ?, next_attempt_at = ? WHERE kind = 'advance'").run(NOW, NOW);
    let attempts = 0;
    const sender = async () => ({ status: ++attempts === 1 ? 503 : 201 });

    expect(await sendDueNotifications(db, sender, NOW)).toMatchObject({ claimed: 1, sent: 0, transientFailures: 1 });
    expect(await sendDueNotifications(db, sender, NOW + 60_000)).toMatchObject({ claimed: 1, sent: 1 });
    expect(await sendDueNotifications(db, sender, NOW + 60_000)).toMatchObject({ claimed: 0, sent: 0 });
    expect(attempts).toBe(2);
  });

  it("disables a subscription after a permanent push failure", async () => {
    await createLog();
    const push = new PushRepository(db);
    await push.upsertSubscription({
      id: "60000000-0000-4000-8000-000000000001",
      logId: LOG_ID,
      deviceId: "50000000-0000-4000-8000-000000000001" as DeviceId,
      endpoint: "https://push.example/subscription",
      p256dh: "key",
      auth: "auth",
      enabled: true,
      advanceEnabled: true,
      advanceMinutes: 30,
      goalEnabled: true,
      now: NOW,
    });
    await fasts.save({ id: FAST_ID, logId: LOG_ID, startAt: NOW, endAt: null, goalHours: 2, now: NOW },
      notificationStatementsForFast(db, { logId: LOG_ID, fastId: FAST_ID, startAt: NOW, endAt: null, goalHours: 2, now: NOW }));
    sqlite.prepare("UPDATE notification_jobs SET due_at = ?, next_attempt_at = ? WHERE kind = 'advance'").run(NOW, NOW);

    await sendDueNotifications(db, async () => ({ status: 410 }), NOW);

    expect(await push.listSubscriptions(LOG_ID)).toEqual([expect.objectContaining({ enabled: false, failedAt: NOW })]);
  });
});
