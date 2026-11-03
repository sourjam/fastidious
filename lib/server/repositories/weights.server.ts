import type { EpochMs, LogId, MutationId, WeightId, WeightRecord } from "../../domain/types";
import { createWeightRecord } from "../../validation/domain";
import { asNullableNumber, asNumber, commitRevisionChange, requireLog } from "../db.server";
import { databaseFailure, RepositoryError } from "../errors.server";

interface WeightRow {
  id: string;
  log_id: string;
  measured_at: number;
  kilograms: number;
  revision: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SaveWeightInput {
  id: WeightId;
  logId: LogId;
  measuredAt: EpochMs;
  kilograms: number;
  now: EpochMs;
  mutationId?: MutationId;
}

function mapWeight(row: WeightRow): WeightRecord {
  return {
    id: row.id as WeightId,
    logId: row.log_id as LogId,
    measuredAt: asNumber(row.measured_at) as EpochMs,
    kilograms: asNumber(row.kilograms),
    revision: asNumber(row.revision),
    updatedAt: asNumber(row.updated_at) as EpochMs,
    deletedAt: asNullableNumber(row.deleted_at) as EpochMs | null,
  };
}

const COLUMNS = "id, log_id, measured_at, kilograms, revision, updated_at, deleted_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isEpoch(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export class WeightRepository {
  constructor(private readonly db: D1Database) {}

  async listSnapshot(logId: LogId): Promise<WeightRecord[]> {
    try {
      const result = await this.db
        .prepare(`SELECT ${COLUMNS} FROM weights WHERE log_id = ? ORDER BY measured_at, id`)
        .bind(logId)
        .all<WeightRow>();
      return result.results.map(mapWeight);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async save(input: SaveWeightInput, additionalStatements: D1PreparedStatement[] = []): Promise<WeightRecord> {
    if (
      !UUID_PATTERN.test(input.id) ||
      !UUID_PATTERN.test(input.logId) ||
      (input.mutationId !== undefined && !UUID_PATTERN.test(input.mutationId)) ||
      !isEpoch(input.measuredAt) ||
      !isEpoch(input.now)
    ) {
      throw new RepositoryError("validation_failure", "Weight identifiers or timestamps are invalid.");
    }
    const ownerLogId = await this.ownerLogId(input.id);
    if (ownerLogId && ownerLogId !== input.logId) {
      throw new RepositoryError("validation_failure", "Weight id is already in use.");
    }
    const validated = createWeightRecord(
      {
        id: input.id,
        logId: input.logId,
        measuredAt: input.measuredAt,
        kilograms: input.kilograms,
      },
      input.now,
    );
    if (!validated.ok) throw new RepositoryError("validation_failure", validated.message);
    await requireLog(this.db, input.logId);
    const statement = this.db
      .prepare(
        `INSERT INTO weights (id, log_id, measured_at, kilograms, revision, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, (SELECT revision FROM logs WHERE id = ?), ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           measured_at = excluded.measured_at,
           kilograms = excluded.kilograms,
           revision = excluded.revision,
           updated_at = excluded.updated_at,
           deleted_at = NULL
         WHERE weights.log_id = excluded.log_id`,
      )
      .bind(input.id, input.logId, input.measuredAt, input.kilograms, input.logId, input.now);
    await commitRevisionChange(this.db, input.logId, statement, {
      entityType: "weight",
      entityId: input.id,
      operation: "upsert",
      payload: {
        id: input.id,
        measuredAt: input.measuredAt,
        kilograms: input.kilograms,
        updatedAt: input.now,
        deletedAt: null,
      },
      createdAt: input.now,
      mutationId: input.mutationId,
    }, additionalStatements);
    return (await this.get(input.logId, input.id))!;
  }

  async delete(
    logId: LogId,
    weightId: WeightId,
    now: EpochMs,
    mutationId?: MutationId,
    additionalStatements: D1PreparedStatement[] = [],
  ): Promise<WeightRecord> {
    if (
      !UUID_PATTERN.test(logId) ||
      !UUID_PATTERN.test(weightId) ||
      (mutationId !== undefined && !UUID_PATTERN.test(mutationId)) ||
      !isEpoch(now)
    ) {
      throw new RepositoryError("validation_failure", "Weight identifiers or timestamps are invalid.");
    }
    const existing = await this.get(logId, weightId);
    if (!existing) throw new RepositoryError("not_found", "Weight was not found.");
    const statement = this.db
      .prepare(
        `UPDATE weights
         SET deleted_at = ?, updated_at = ?, revision = (SELECT revision FROM logs WHERE id = ?)
         WHERE id = ? AND log_id = ?`,
      )
      .bind(now, now, logId, weightId, logId);
    await commitRevisionChange(this.db, logId, statement, {
      entityType: "weight",
      entityId: weightId,
      operation: "delete",
      payload: { id: weightId, deletedAt: now },
      createdAt: now,
      mutationId,
    }, additionalStatements);
    return (await this.get(logId, weightId))!;
  }

  private async ownerLogId(weightId: WeightId): Promise<string | null> {
    try {
      const row = await this.db
        .prepare("SELECT log_id FROM weights WHERE id = ?")
        .bind(weightId)
        .first<{ log_id: string }>();
      return row?.log_id ?? null;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  private async get(logId: LogId, weightId: WeightId): Promise<WeightRecord | null> {
    try {
      const row = await this.db
        .prepare(`SELECT ${COLUMNS} FROM weights WHERE log_id = ? AND id = ?`)
        .bind(logId, weightId)
        .first<WeightRow>();
      return row ? mapWeight(row) : null;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }
}
