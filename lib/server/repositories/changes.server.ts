import type { LogId, MutationId } from "../../domain/types";
import { asNumber, commitRevisionChange, requireLog, type ChangeInput } from "../db.server";
import { databaseFailure, RepositoryError } from "../errors.server";

interface ChangeRow {
  log_id: string;
  revision: number;
  entity_type: ChangeRecord["entityType"];
  entity_id: string;
  operation: ChangeRecord["operation"];
  payload: string;
  created_at: number;
}

export interface ChangeRecord {
  logId: LogId;
  revision: number;
  entityType: ChangeInput["entityType"];
  entityId: string;
  operation: ChangeInput["operation"];
  payload: unknown;
  createdAt: number;
}

export interface AppendChangeInput extends Omit<ChangeInput, "mutationId"> {
  logId: LogId;
  mutationId?: MutationId;
}

function mapChange(row: ChangeRow): ChangeRecord {
  return {
    logId: row.log_id as LogId,
    revision: asNumber(row.revision),
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: asNumber(row.created_at),
  };
}

export class ChangeRepository {
  constructor(private readonly db: D1Database) {}

  async append(input: AppendChangeInput): Promise<number> {
    await requireLog(this.db, input.logId);
    return commitRevisionChange(this.db, input.logId, this.db.prepare("SELECT 1"), {
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      payload: input.payload,
      createdAt: input.createdAt,
      mutationId: input.mutationId,
    });
  }

  async fetchAfter(logId: LogId, cursor: number, limit = 500): Promise<ChangeRecord[]> {
    if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1) {
      throw new RepositoryError("validation_failure", "Change cursor or limit is invalid.");
    }
    try {
      const result = await this.db
        .prepare(
          `SELECT log_id, revision, entity_type, entity_id, operation, payload, created_at
           FROM changes WHERE log_id = ? AND revision > ? ORDER BY revision LIMIT ?`,
        )
        .bind(logId, cursor, limit)
        .all<ChangeRow>();
      return result.results.map(mapChange);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async requiresFullSnapshot(logId: LogId, cursor: number): Promise<boolean> {
    if (!Number.isInteger(cursor) || cursor < 0) return true;
    try {
      const state = await this.db
        .prepare(
          `SELECT logs.revision AS current_revision, MIN(changes.revision) AS first_revision
           FROM logs LEFT JOIN changes ON changes.log_id = logs.id
           WHERE logs.id = ? GROUP BY logs.id`,
        )
        .bind(logId)
        .first<{ current_revision: number; first_revision: number | null }>();
      if (!state) throw new RepositoryError("not_found", "Log was not found.");
      const current = asNumber(state.current_revision);
      if (cursor > current) return true;
      return state.first_revision !== null && cursor + 1 < asNumber(state.first_revision);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async assertDataGeneration(logId: LogId, generation: number): Promise<void> {
    try {
      const row = await this.db
        .prepare("SELECT data_generation FROM logs WHERE id = ?")
        .bind(logId)
        .first<{ data_generation: number }>();
      if (!row) throw new RepositoryError("not_found", "Log was not found.");
      if (asNumber(row.data_generation) !== generation) {
        throw new RepositoryError("generation_mismatch", "The data generation has changed.");
      }
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }
}
