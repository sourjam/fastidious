import type { EpochMs, FastId, FastRecord, LogId, MutationId } from "../../domain/types";
import { createFastRecord } from "../../validation/domain";
import { asNullableNumber, asNumber, commitRevisionChange, requireLog } from "../db.server";
import { databaseFailure, RepositoryError } from "../errors.server";

interface FastRow {
  id: string;
  log_id: string;
  start_at: number;
  end_at: number | null;
  goal_hours: number;
  revision: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SaveFastInput {
  id: FastId;
  logId: LogId;
  startAt: EpochMs;
  endAt: EpochMs | null;
  goalHours: number;
  now: EpochMs;
  mutationId?: MutationId;
}

function mapFast(row: FastRow): FastRecord {
  return {
    id: row.id as FastId,
    logId: row.log_id as LogId,
    startAt: asNumber(row.start_at) as EpochMs,
    endAt: asNullableNumber(row.end_at) as EpochMs | null,
    goalHours: asNumber(row.goal_hours),
    revision: asNumber(row.revision),
    updatedAt: asNumber(row.updated_at) as EpochMs,
    deletedAt: asNullableNumber(row.deleted_at) as EpochMs | null,
  };
}

const COLUMNS = "id, log_id, start_at, end_at, goal_hours, revision, updated_at, deleted_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isEpoch(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export class FastRepository {
  constructor(private readonly db: D1Database) {}

  async listSnapshot(logId: LogId): Promise<FastRecord[]> {
    try {
      const result = await this.db
        .prepare(`SELECT ${COLUMNS} FROM fasts WHERE log_id = ? ORDER BY start_at, id`)
        .bind(logId)
        .all<FastRow>();
      return result.results.map(mapFast);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async active(logId: LogId): Promise<FastRecord | null> {
    try {
      const row = await this.db
        .prepare(`SELECT ${COLUMNS} FROM fasts WHERE log_id = ? AND end_at IS NULL AND deleted_at IS NULL`)
        .bind(logId)
        .first<FastRow>();
      return row ? mapFast(row) : null;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async save(input: SaveFastInput, additionalStatements: D1PreparedStatement[] = []): Promise<FastRecord> {
    if (
      !UUID_PATTERN.test(input.id) ||
      !UUID_PATTERN.test(input.logId) ||
      (input.mutationId !== undefined && !UUID_PATTERN.test(input.mutationId)) ||
      !isEpoch(input.startAt) ||
      (input.endAt !== null && !isEpoch(input.endAt)) ||
      !isEpoch(input.now)
    ) {
      throw new RepositoryError("validation_failure", "Fast identifiers or timestamps are invalid.");
    }
    const existing = (await this.listSnapshot(input.logId)).filter((record) => record.id !== input.id);
    const ownerLogId = await this.ownerLogId(input.id);
    if (ownerLogId && ownerLogId !== input.logId) {
      throw new RepositoryError("validation_failure", "Fast id is already in use.");
    }
    const validated = createFastRecord(
      {
        id: input.id,
        logId: input.logId,
        startAt: input.startAt,
        endAt: input.endAt,
        goalHours: input.goalHours,
      },
      input.now,
      existing,
    );
    if (!validated.ok) {
      if (validated.code === "active_fast_exists") {
        throw new RepositoryError("active_fast_conflict", validated.message);
      }
      if (validated.code === "fast_overlap") throw new RepositoryError("overlap", validated.message);
      throw new RepositoryError("validation_failure", validated.message);
    }
    await requireLog(this.db, input.logId);
    const statement = ownerLogId
      ? this.db.prepare(
          `UPDATE fasts SET start_at = ?, end_at = ?, goal_hours = ?,
             revision = (SELECT revision FROM logs WHERE id = ?), updated_at = ?, deleted_at = NULL
           WHERE id = ? AND log_id = ?`,
        ).bind(input.startAt, input.endAt, input.goalHours, input.logId, input.now, input.id, input.logId)
      : this.db.prepare(
          `INSERT INTO fasts (id, log_id, start_at, end_at, goal_hours, revision, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, (SELECT revision FROM logs WHERE id = ?), ?, NULL)`,
        ).bind(input.id, input.logId, input.startAt, input.endAt, input.goalHours, input.logId, input.now);
    await commitRevisionChange(this.db, input.logId, statement, {
      entityType: "fast",
      entityId: input.id,
      operation: "upsert",
      payload: {
        id: input.id,
        startAt: input.startAt,
        endAt: input.endAt,
        goalHours: input.goalHours,
        updatedAt: input.now,
        deletedAt: null,
      },
      createdAt: input.now,
      mutationId: input.mutationId,
    }, additionalStatements);
    return (await this.get(input.logId, input.id))!;
  }

  async saveReplacingActive(input: SaveFastInput, notificationStatements: D1PreparedStatement[] = []): Promise<FastRecord> {
    if (
      !UUID_PATTERN.test(input.id) ||
      !UUID_PATTERN.test(input.logId) ||
      (input.mutationId !== undefined && !UUID_PATTERN.test(input.mutationId)) ||
      !isEpoch(input.startAt) ||
      (input.endAt !== null && !isEpoch(input.endAt)) ||
      !isEpoch(input.now)
    ) {
      throw new RepositoryError("validation_failure", "Fast identifiers or timestamps are invalid.");
    }
    if (input.endAt !== null || !input.mutationId) return this.save(input, notificationStatements);
    const prior = await this.active(input.logId);
    if (!prior || prior.id === input.id) return this.save(input, notificationStatements);
    const ownerLogId = await this.ownerLogId(input.id);
    if (ownerLogId && ownerLogId !== input.logId) {
      throw new RepositoryError("validation_failure", "Fast id is already in use.");
    }
    const existing = (await this.listSnapshot(input.logId)).filter((record) => record.id !== prior.id);
    const validated = createFastRecord(
      {
        id: input.id,
        logId: input.logId,
        startAt: input.startAt,
        endAt: null,
        goalHours: input.goalHours,
      },
      input.now,
      existing,
    );
    if (!validated.ok) {
      if (validated.code === "fast_overlap") throw new RepositoryError("overlap", validated.message);
      throw new RepositoryError("validation_failure", validated.message);
    }
    const statements = [
      this.db.prepare("UPDATE logs SET revision = revision + 2, updated_at = ? WHERE id = ?").bind(input.now, input.logId),
      this.db.prepare(
        `UPDATE fasts SET deleted_at = ?, updated_at = ?, revision = (SELECT revision - 1 FROM logs WHERE id = ?)
         WHERE id = ? AND log_id = ?`,
      ).bind(input.now, input.now, input.logId, prior.id, input.logId),
      this.db.prepare(
        `INSERT INTO changes (log_id, revision, entity_type, entity_id, operation, payload, created_at)
         SELECT id, revision - 1, 'fast', ?, 'delete', json_object('id', ?, 'deletedAt', ?), ?
         FROM logs WHERE id = ?`,
      ).bind(prior.id, prior.id, input.now, input.now, input.logId),
      this.db.prepare(
        `INSERT INTO fasts (id, log_id, start_at, end_at, goal_hours, revision, updated_at, deleted_at)
         SELECT ?, id, ?, NULL, ?, revision, ?, NULL FROM logs WHERE id = ?
         ON CONFLICT(id) DO UPDATE SET start_at = excluded.start_at, end_at = NULL,
           goal_hours = excluded.goal_hours, revision = excluded.revision,
           updated_at = excluded.updated_at, deleted_at = NULL
         WHERE fasts.log_id = excluded.log_id`,
      ).bind(input.id, input.startAt, input.goalHours, input.now, input.logId),
      this.db.prepare(
        `INSERT INTO changes (log_id, revision, entity_type, entity_id, operation, payload, created_at)
         SELECT id, revision, 'fast', ?, 'upsert',
           json_object('id', ?, 'startAt', ?, 'endAt', NULL, 'goalHours', ?, 'updatedAt', ?, 'deletedAt', NULL), ?
         FROM logs WHERE id = ?`,
      ).bind(input.id, input.id, input.startAt, input.goalHours, input.now, input.now, input.logId),
      ...notificationStatements,
      this.db.prepare(
        `INSERT INTO mutation_receipts (log_id, mutation_id, applied_revision, created_at)
         SELECT id, ?, revision, ? FROM logs WHERE id = ?`,
      ).bind(input.mutationId, input.now, input.logId),
    ];
    try {
      await this.db.batch(statements);
      const saved = await this.get(input.logId, input.id);
      if (!saved) throw new RepositoryError("transient_database_failure", "Fast was not stored.");
      return saved;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async delete(
    logId: LogId,
    fastId: FastId,
    now: EpochMs,
    mutationId?: MutationId,
    additionalStatements: D1PreparedStatement[] = [],
  ): Promise<FastRecord> {
    if (
      !UUID_PATTERN.test(logId) ||
      !UUID_PATTERN.test(fastId) ||
      (mutationId !== undefined && !UUID_PATTERN.test(mutationId)) ||
      !isEpoch(now)
    ) {
      throw new RepositoryError("validation_failure", "Fast identifiers or timestamps are invalid.");
    }
    const existing = await this.get(logId, fastId);
    if (!existing) throw new RepositoryError("not_found", "Fast was not found.");
    const statement = this.db
      .prepare(
        `UPDATE fasts
         SET deleted_at = ?, updated_at = ?, revision = (SELECT revision FROM logs WHERE id = ?)
         WHERE id = ? AND log_id = ?`,
      )
      .bind(now, now, logId, fastId, logId);
    await commitRevisionChange(this.db, logId, statement, {
      entityType: "fast",
      entityId: fastId,
      operation: "delete",
      payload: { id: fastId, deletedAt: now },
      createdAt: now,
      mutationId,
    }, additionalStatements);
    return (await this.get(logId, fastId))!;
  }

  private async ownerLogId(fastId: FastId): Promise<string | null> {
    try {
      const row = await this.db
        .prepare("SELECT log_id FROM fasts WHERE id = ?")
        .bind(fastId)
        .first<{ log_id: string }>();
      return row?.log_id ?? null;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  private async get(logId: LogId, fastId: FastId): Promise<FastRecord | null> {
    try {
      const row = await this.db
        .prepare(`SELECT ${COLUMNS} FROM fasts WHERE log_id = ? AND id = ?`)
        .bind(logId, fastId)
        .first<FastRow>();
      return row ? mapFast(row) : null;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }
}
