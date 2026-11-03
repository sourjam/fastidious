import type { FastId, LogId } from "../domain/types";

const HOUR_MS = 3_600_000;

export function notificationStatementsForFast(
  db: D1Database,
  input: {
    logId: LogId;
    fastId: FastId;
    startAt?: number;
    endAt?: number | null;
    goalHours?: number;
    now: number;
    cancelOtherFasts?: boolean;
  },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (input.cancelOtherFasts) {
    statements.push(
      db.prepare(
        "UPDATE notification_jobs SET status = 'cancelled', claim_token = NULL WHERE log_id = ? AND fast_id <> ? AND status IN ('pending', 'processing')",
      ).bind(input.logId, input.fastId),
    );
  }
  statements.push(
    db.prepare(
      "UPDATE notification_jobs SET status = 'cancelled', claim_token = NULL WHERE log_id = ? AND fast_id = ? AND status IN ('pending', 'processing')",
    ).bind(input.logId, input.fastId),
  );

  if (input.endAt !== null || input.startAt === undefined || input.goalHours === undefined) return statements;
  const goalAt = Math.round(input.startAt + input.goalHours * HOUR_MS);
  statements.push(
    db.prepare(
      `INSERT INTO notification_jobs (
         id, log_id, fast_id, subscription_id, kind, due_at, status, claim_token,
         claimed_at, attempted_at, attempt_count, next_attempt_at, created_at
       )
       SELECT ps.id || ':' || ? || ':advance', ps.log_id, ?, ps.id, 'advance',
              ? - ps.advance_minutes * 60000, 'pending', NULL, NULL, NULL, 0,
              ? - ps.advance_minutes * 60000, ?
       FROM push_subscriptions ps
       WHERE ps.log_id = ? AND ps.enabled = 1 AND ps.advance_enabled = 1
         AND ? - ps.advance_minutes * 60000 > ?
       ON CONFLICT(subscription_id, fast_id, kind) DO UPDATE SET
         due_at = excluded.due_at, status = 'pending', claim_token = NULL,
         claimed_at = NULL, attempted_at = NULL, attempt_count = 0,
         next_attempt_at = excluded.next_attempt_at`,
    ).bind(input.fastId, input.fastId, goalAt, goalAt, input.now, input.logId, goalAt, input.now),
    db.prepare(
      `INSERT INTO notification_jobs (
         id, log_id, fast_id, subscription_id, kind, due_at, status, claim_token,
         claimed_at, attempted_at, attempt_count, next_attempt_at, created_at
       )
       SELECT ps.id || ':' || ? || ':goal', ps.log_id, ?, ps.id, 'goal',
              ?, 'pending', NULL, NULL, NULL, 0, ?, ?
       FROM push_subscriptions ps
       WHERE ps.log_id = ? AND ps.enabled = 1 AND ps.goal_enabled = 1 AND ? > ?
       ON CONFLICT(subscription_id, fast_id, kind) DO UPDATE SET
         due_at = excluded.due_at, status = 'pending', claim_token = NULL,
         claimed_at = NULL, attempted_at = NULL, attempt_count = 0,
         next_attempt_at = excluded.next_attempt_at`,
    ).bind(input.fastId, input.fastId, goalAt, goalAt, input.now, input.logId, goalAt, input.now),
  );
  return statements;
}

export function notificationStatementsForMutation(
  db: D1Database,
  input: { logId: LogId; operation: string; payload: unknown; now: number },
): D1PreparedStatement[] {
  if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) return [];
  const payload = input.payload as Record<string, unknown>;
  if (typeof payload.id !== "string") return [];
  if (input.operation === "delete") {
    return notificationStatementsForFast(db, {
      logId: input.logId,
      fastId: payload.id as FastId,
      endAt: 0,
      now: input.now,
    });
  }
  if (typeof payload.startAt !== "number" || typeof payload.goalHours !== "number") return [];
  return notificationStatementsForFast(db, {
    logId: input.logId,
    fastId: payload.id as FastId,
    startAt: payload.startAt,
    endAt: payload.endAt === null ? null : typeof payload.endAt === "number" ? payload.endAt : undefined,
    goalHours: payload.goalHours,
    now: input.now,
    cancelOtherFasts: payload.endAt === null,
  });
}
