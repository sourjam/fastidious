import type { EpochMs, FastId, FastRecord, IanaTimezone, LogId, WeightId, WeightRecord } from "../domain/types";
import { isValidTimezone } from "../domain/locale";
import { emptyDailyLogSnapshot, type ServerSnapshot } from "../local-db/schema";
import { digestSecret, generateSecret, isCanonicalSecret } from "./crypto.server";
import { asNullableNumber, asNumber } from "./db.server";
import { RepositoryError } from "./errors.server";
import { DailyLogRepository } from "./repositories/daily-log.server";
import { LogRepository, type PublicLogMetadata } from "./repositories/logs.server";

export interface AuthContext {
  log: PublicLogMetadata;
}

export interface CreateLogDefaults {
  timezone: string;
  weightUnit: "kg" | "lb";
}

function bearerSecret(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.slice(7).includes(" ")) {
    throw new RepositoryError("unauthorized", "Access is not authorized.");
  }
  const secret = authorization.slice(7);
  if (!isCanonicalSecret(secret)) throw new RepositoryError("unauthorized", "Access is not authorized.");
  return secret;
}

export async function authenticateRequest(
  request: Request,
  db: D1Database,
  pepper: string | undefined,
  now = Date.now(),
): Promise<AuthContext> {
  const secret = bearerSecret(request);
  const log = await new LogRepository(db).authenticateAndTouch(await digestSecret(secret, pepper), now);
  return { log };
}

function validateDefaults(value: unknown): CreateLogDefaults {
  if (typeof value !== "object" || value === null) {
    throw new RepositoryError("validation_failure", "Log defaults are required.");
  }
  const defaults = value as Record<string, unknown>;
  if (
    typeof defaults.timezone !== "string" ||
    !isValidTimezone(defaults.timezone) ||
    (defaults.weightUnit !== "kg" && defaults.weightUnit !== "lb")
  ) {
    throw new RepositoryError("validation_failure", "Timezone or weight unit is invalid.");
  }
  return { timezone: defaults.timezone, weightUnit: defaults.weightUnit };
}

export async function createLog(
  db: D1Database,
  value: unknown,
  pepper: string | undefined,
  now = Date.now(),
): Promise<{ secret: string; snapshot: ServerSnapshot }> {
  const defaults = validateDefaults(value);
  const secret = generateSecret();
  const log = await new LogRepository(db).create({
    secretDigest: await digestSecret(secret, pepper),
    preferences: {
      timezone: defaults.timezone as IanaTimezone,
      weightUnit: defaults.weightUnit,
      theme: "system",
      defaultGoalHours: 16,
    },
    now,
  });
  return { secret, snapshot: emptySnapshot(log) };
}

export async function rotateSecret(
  db: D1Database,
  auth: AuthContext,
  confirmation: unknown,
  pepper: string | undefined,
  now = Date.now(),
): Promise<{ secret: string; credentialGeneration: number }> {
  if (
    typeof confirmation !== "object" ||
    confirmation === null ||
    (confirmation as Record<string, unknown>).confirm !== true ||
    (confirmation as Record<string, unknown>).version !== 1
  ) {
    throw new RepositoryError("validation_failure", "Rotation requires explicit confirmation.");
  }
  const secret = generateSecret();
  const log = await new LogRepository(db).rotateDigest(
    auth.log.id,
    await digestSecret(secret, pepper),
    auth.log.credentialGeneration,
    now,
  );
  return { secret, credentialGeneration: log.credentialGeneration };
}

function emptySnapshot(log: PublicLogMetadata): ServerSnapshot {
  return {
    logId: log.id,
    cursor: log.revision,
    serverGeneration: 1,
    dataGeneration: log.dataGeneration,
    credentialGeneration: log.credentialGeneration,
    fasts: [],
    weights: [],
    ...emptyDailyLogSnapshot(),
    preferences: log.preferences,
  };
}

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

interface WeightRow {
  id: string;
  log_id: string;
  measured_at: number;
  kilograms: number;
  revision: number;
  updated_at: number;
  deleted_at: number | null;
}

export async function loadSnapshot(db: D1Database, log: PublicLogMetadata): Promise<ServerSnapshot> {
  const [fastResult, weightResult] = await db.batch<FastRow | WeightRow>([
    db.prepare(
      `SELECT id, log_id, start_at, end_at, goal_hours, revision, updated_at, deleted_at
       FROM fasts WHERE log_id = ? AND deleted_at IS NULL ORDER BY start_at`,
    ).bind(log.id),
    db.prepare(
      `SELECT id, log_id, measured_at, kilograms, revision, updated_at, deleted_at
       FROM weights WHERE log_id = ? AND deleted_at IS NULL ORDER BY measured_at`,
    ).bind(log.id),
  ]);
  const fasts = fastResult!.results.map((raw) => {
    const row = raw as FastRow;
    return {
      id: row.id as FastId,
      logId: row.log_id as LogId,
      startAt: asNumber(row.start_at) as EpochMs,
      endAt: asNullableNumber(row.end_at) as EpochMs | null,
      goalHours: asNumber(row.goal_hours),
      revision: asNumber(row.revision),
      updatedAt: asNumber(row.updated_at) as EpochMs,
      deletedAt: asNullableNumber(row.deleted_at) as EpochMs | null,
    } satisfies FastRecord;
  });
  const weights = weightResult!.results.map((raw) => {
    const row = raw as WeightRow;
    return {
      id: row.id as WeightId,
      logId: row.log_id as LogId,
      measuredAt: asNumber(row.measured_at) as EpochMs,
      kilograms: asNumber(row.kilograms),
      revision: asNumber(row.revision),
      updatedAt: asNumber(row.updated_at) as EpochMs,
      deletedAt: asNullableNumber(row.deleted_at) as EpochMs | null,
    } satisfies WeightRecord;
  });
  const dailyLog = await new DailyLogRepository(db).loadSnapshot(log.id);
  return { ...emptySnapshot(log), fasts, weights, ...dailyLog };
}
