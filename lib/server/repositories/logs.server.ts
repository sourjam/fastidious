import type { IanaTimezone, LogId, LogPreferences, ThemePreference, WeightUnit } from "../../domain/types";
import { validateLogPreferences } from "../../validation/domain";
import { asNumber, changedRows } from "../db.server";
import { databaseFailure, RepositoryError } from "../errors.server";

const TOUCH_INTERVAL_MS = 60 * 60 * 1_000;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LogRow {
  id: string;
  credential_generation: number;
  data_generation: number;
  revision: number;
  timezone: string;
  theme: ThemePreference;
  weight_unit: WeightUnit;
  default_goal_hours: number;
  created_at: number;
  updated_at: number;
  last_access_at: number;
  expires_at: number;
}

export interface PublicLogMetadata {
  id: LogId;
  credentialGeneration: number;
  dataGeneration: number;
  revision: number;
  preferences: LogPreferences;
  createdAt: number;
  updatedAt: number;
  lastAccessAt: number;
  expiresAt: number;
}

export interface CreateLogInput {
  id?: LogId;
  secretDigest: string;
  preferences: LogPreferences;
  now: number;
  expiresAt?: number;
}

function mapLog(row: LogRow): PublicLogMetadata {
  return {
    id: row.id as LogId,
    credentialGeneration: asNumber(row.credential_generation),
    dataGeneration: asNumber(row.data_generation),
    revision: asNumber(row.revision),
    preferences: {
      timezone: row.timezone as IanaTimezone,
      theme: row.theme,
      weightUnit: row.weight_unit,
      defaultGoalHours: asNumber(row.default_goal_hours),
    },
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
    lastAccessAt: asNumber(row.last_access_at),
    expiresAt: asNumber(row.expires_at),
  };
}

const PUBLIC_COLUMNS = `id, credential_generation, data_generation, revision, timezone, theme,
  weight_unit, default_goal_hours, created_at, updated_at, last_access_at, expires_at`;

export class LogRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: CreateLogInput): Promise<PublicLogMetadata> {
    const preferences = validateLogPreferences(input.preferences);
    if (!preferences.ok || !DIGEST_PATTERN.test(input.secretDigest)) {
      throw new RepositoryError("validation_failure", "Log settings or secret digest are invalid.");
    }
    const id = input.id ?? (crypto.randomUUID() as LogId);
    if (!UUID_PATTERN.test(id)) throw new RepositoryError("validation_failure", "Log id is invalid.");
    const expiresAt = input.expiresAt ?? addCalendarMonths(input.now, 12);
    if (!Number.isInteger(input.now) || input.now < 0 || !Number.isInteger(expiresAt) || expiresAt <= input.now) {
      throw new RepositoryError("validation_failure", "Log timestamps are invalid.");
    }
    try {
      await this.db
        .prepare(
          `INSERT INTO logs (
             id, secret_digest, timezone, theme, weight_unit, default_goal_hours,
             created_at, updated_at, last_access_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.secretDigest,
          preferences.value.timezone,
          preferences.value.theme,
          preferences.value.weightUnit,
          preferences.value.defaultGoalHours,
          input.now,
          input.now,
          input.now,
          expiresAt,
        )
        .run();
      return (await this.get(id))!;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async get(logId: LogId): Promise<PublicLogMetadata | null> {
    try {
      const row = await this.db
        .prepare(`SELECT ${PUBLIC_COLUMNS} FROM logs WHERE id = ?`)
        .bind(logId)
        .first<LogRow>();
      return row ? mapLog(row) : null;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async authenticateAndTouch(digest: string, now: number, retentionMs?: number): Promise<PublicLogMetadata> {
    if (!DIGEST_PATTERN.test(digest) || !Number.isInteger(now) || (retentionMs !== undefined && retentionMs <= 0)) {
      throw new RepositoryError("unauthorized", "Access is not authorized.");
    }
    try {
      const row = await this.db
        .prepare(`SELECT ${PUBLIC_COLUMNS} FROM logs WHERE secret_digest = ?`)
        .bind(digest)
        .first<LogRow>();
      if (!row) {
        const expired = await this.db
          .prepare("SELECT 1 AS present FROM expired_logs WHERE digest_marker = ? AND purge_after > ?")
          .bind(digest, now)
          .first();
        if (expired) throw new RepositoryError("expired", "This log has expired.");
        const revoked = await this.db
          .prepare("SELECT 1 AS present FROM revoked_secrets WHERE digest_marker = ?")
          .bind(digest)
          .first();
        if (revoked) throw new RepositoryError("revoked", "This access link was revoked.");
        throw new RepositoryError("unauthorized", "Access is not authorized.");
      }
      if (asNumber(row.expires_at) <= now) throw new RepositoryError("expired", "This log has expired.");
      if (now - asNumber(row.last_access_at) < TOUCH_INTERVAL_MS) return mapLog(row);
      const expiresAt = retentionMs === undefined ? addCalendarMonths(now, 12) : now + retentionMs;
      await this.db
        .prepare("UPDATE logs SET last_access_at = ?, expires_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, expiresAt, now, row.id)
        .run();
      return mapLog({ ...row, last_access_at: now, expires_at: expiresAt, updated_at: now });
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async rotateDigest(logId: LogId, newDigest: string, expectedGeneration: number, now: number): Promise<PublicLogMetadata> {
    if (!DIGEST_PATTERN.test(newDigest)) {
      throw new RepositoryError("validation_failure", "Secret digest is invalid.");
    }
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO revoked_secrets (digest_marker, revoked_at)
             SELECT secret_digest, ? FROM logs WHERE id = ? AND credential_generation = ?`,
          )
          .bind(now, logId, expectedGeneration),
        this.db
          .prepare(
            `UPDATE logs
             SET secret_digest = ?, credential_generation = credential_generation + 1, updated_at = ?
             WHERE id = ? AND credential_generation = ?`,
          )
          .bind(newDigest, now, logId, expectedGeneration),
      ]);
      if (changedRows(results[1]!) === 0) {
        const existing = await this.get(logId);
        if (!existing) throw new RepositoryError("not_found", "Log was not found.");
        throw new RepositoryError("revoked", "The credential generation has changed.");
      }
      return (await this.get(logId))!;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async incrementDataGeneration(logId: LogId, now: number): Promise<PublicLogMetadata> {
    try {
      const results = await this.db.batch<LogRow>([
        this.db
          .prepare(
            `UPDATE logs
             SET data_generation = data_generation + 1, revision = revision + 1, updated_at = ?
             WHERE id = ?`,
          )
          .bind(now, logId),
        this.db
          .prepare(
            `INSERT INTO changes (log_id, revision, entity_type, entity_id, operation, payload, created_at)
             SELECT id, revision, 'generation', id, 'reset',
                    json_object('dataGeneration', data_generation), ?
             FROM logs WHERE id = ?`,
          )
          .bind(now, logId),
        this.db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM logs WHERE id = ?`).bind(logId),
      ]);
      const row = results[2]?.results[0];
      if (!row) throw new RepositoryError("not_found", "Log was not found.");
      return mapLog(row);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async incrementCredentialGeneration(logId: LogId, now: number): Promise<PublicLogMetadata> {
    try {
      const result = await this.db
        .prepare("UPDATE logs SET credential_generation = credential_generation + 1, updated_at = ? WHERE id = ?")
        .bind(now, logId)
        .run();
      if (changedRows(result) === 0) throw new RepositoryError("not_found", "Log was not found.");
      return (await this.get(logId))!;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async listDueForExpiration(now: number, limit = 100): Promise<PublicLogMetadata[]> {
    try {
      const result = await this.db
        .prepare(`SELECT ${PUBLIC_COLUMNS} FROM logs WHERE expires_at <= ? ORDER BY expires_at LIMIT ?`)
        .bind(now, limit)
        .all<LogRow>();
      return result.results.map(mapLog);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async expire(logId: LogId, expiredAt: number, purgeAfter: number): Promise<boolean> {
    if (purgeAfter < expiredAt) throw new RepositoryError("validation_failure", "Expired marker retention is invalid.");
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT OR IGNORE INTO expired_logs (digest_marker, expired_at, purge_after)
             SELECT secret_digest, ?, ? FROM logs WHERE id = ? AND expires_at <= ?`,
          )
          .bind(expiredAt, purgeAfter, logId, expiredAt),
        this.db.prepare(
          "UPDATE image_assets SET status = 'pending_delete', delete_after = ?, updated_at = ? WHERE log_id = ? AND EXISTS (SELECT 1 FROM logs WHERE id = ? AND expires_at <= ?)",
        ).bind(expiredAt, expiredAt, logId, logId, expiredAt),
        this.db.prepare("DELETE FROM logs WHERE id = ? AND expires_at <= ?").bind(logId, expiredAt),
      ]);
      return changedRows(results[2]!) > 0;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }
}

export function addCalendarMonths(timestamp: number, months: number): number {
  const source = new Date(timestamp);
  const targetMonth = source.getUTCMonth() + months;
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  return Date.UTC(
    targetYear,
    month,
    Math.min(source.getUTCDate(), lastDay),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  );
}
