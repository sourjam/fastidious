import type { DeviceId, FastId, LogId } from "../../domain/types";
import { notificationStatementsForFast } from "../../notifications/jobs.server";
import { asNullableNumber, asNumber, changedRows } from "../db.server";
import { databaseFailure, RepositoryError } from "../errors.server";

export type AdvanceMinutes = 15 | 30 | 60;
export type NotificationKind = "advance" | "goal";

interface PushSubscriptionRow {
  id: string;
  log_id: string;
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: number;
  advance_enabled: number;
  advance_minutes: number;
  goal_enabled: number;
  created_at: number;
  last_success_at: number | null;
  failed_at: number | null;
}

interface NotificationJobRow {
  id: string;
  log_id: string;
  fast_id: string;
  subscription_id: string;
  kind: NotificationKind;
  due_at: number;
  status: "pending" | "processing" | "sent" | "cancelled";
  claim_token: string | null;
  claimed_at: number | null;
  attempted_at: number | null;
  attempt_count: number;
  next_attempt_at: number;
  created_at: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  advance_minutes: number;
  goal_hours: number;
}

export interface PushSubscriptionRecord {
  id: string;
  logId: LogId;
  deviceId: DeviceId;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
  advanceEnabled: boolean;
  advanceMinutes: AdvanceMinutes;
  goalEnabled: boolean;
  createdAt: number;
  lastSuccessAt: number | null;
  failedAt: number | null;
}

export interface ClaimedNotificationJob {
  id: string;
  logId: LogId;
  fastId: FastId;
  subscriptionId: string;
  kind: NotificationKind;
  dueAt: number;
  claimToken: string;
  attemptCount: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  advanceMinutes: AdvanceMinutes;
  goalHours: number;
}

export interface UpsertSubscriptionInput {
  id: string;
  logId: LogId;
  deviceId: DeviceId;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
  advanceEnabled: boolean;
  advanceMinutes: AdvanceMinutes;
  goalEnabled: boolean;
  now: number;
}

const SUBSCRIPTION_COLUMNS = `id, log_id, device_id, endpoint, p256dh, auth, enabled,
  advance_enabled, advance_minutes, goal_enabled, created_at, last_success_at, failed_at`;

function mapSubscription(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    logId: row.log_id as LogId,
    deviceId: row.device_id as DeviceId,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    enabled: asNumber(row.enabled) === 1,
    advanceEnabled: asNumber(row.advance_enabled) === 1,
    advanceMinutes: asNumber(row.advance_minutes) as AdvanceMinutes,
    goalEnabled: asNumber(row.goal_enabled) === 1,
    createdAt: asNumber(row.created_at),
    lastSuccessAt: asNullableNumber(row.last_success_at),
    failedAt: asNullableNumber(row.failed_at),
  };
}

export class PushRepository {
  constructor(private readonly db: D1Database) {}

  async listSubscriptions(logId: LogId): Promise<PushSubscriptionRecord[]> {
    try {
      const result = await this.db.prepare(
        `SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscriptions WHERE log_id = ? ORDER BY created_at`,
      ).bind(logId).all<PushSubscriptionRow>();
      return result.results.map(mapSubscription);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async upsertSubscription(input: UpsertSubscriptionInput): Promise<PushSubscriptionRecord> {
    const statement = this.db.prepare(
      `INSERT INTO push_subscriptions (
         id, log_id, device_id, endpoint, p256dh, auth, enabled, advance_enabled,
         advance_minutes, goal_enabled, created_at, last_success_at, failed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
       ON CONFLICT(log_id, device_id) DO UPDATE SET
         endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
         enabled = excluded.enabled, advance_enabled = excluded.advance_enabled,
         advance_minutes = excluded.advance_minutes, goal_enabled = excluded.goal_enabled,
         failed_at = NULL`,
    ).bind(
      input.id, input.logId, input.deviceId, input.endpoint, input.p256dh, input.auth,
      input.enabled ? 1 : 0, input.advanceEnabled ? 1 : 0, input.advanceMinutes,
      input.goalEnabled ? 1 : 0, input.now,
    );
    const active = await this.db.prepare(
      "SELECT id, start_at, goal_hours FROM fasts WHERE log_id = ? AND end_at IS NULL AND deleted_at IS NULL",
    ).bind(input.logId).first<{ id: string; start_at: number; goal_hours: number }>();
    const schedule = active ? notificationStatementsForFast(this.db, {
      logId: input.logId,
      fastId: active.id as FastId,
      startAt: asNumber(active.start_at),
      endAt: null,
      goalHours: asNumber(active.goal_hours),
      now: input.now,
    }) : [];
    try {
      await this.db.batch([statement, ...schedule]);
      const saved = await this.db.prepare(
        `SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscriptions WHERE log_id = ? AND device_id = ?`,
      ).bind(input.logId, input.deviceId).first<PushSubscriptionRow>();
      if (!saved) throw new RepositoryError("transient_database_failure", "Push subscription was not stored.");
      return mapSubscription(saved);
    } catch (cause) {
      if (cause instanceof RepositoryError) throw cause;
      const message = cause instanceof Error ? cause.message : "";
      if (message.includes("UNIQUE constraint failed: push_subscriptions.endpoint")) {
        throw new RepositoryError("validation_failure", "Push endpoint is already registered.");
      }
      throw databaseFailure(cause);
    }
  }

  async deleteSubscription(logId: LogId, deviceId: DeviceId): Promise<void> {
    try {
      await this.db.prepare("DELETE FROM push_subscriptions WHERE log_id = ? AND device_id = ?").bind(logId, deviceId).run();
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async claimDueJobs(now: number, claimToken: string, limit = 25): Promise<ClaimedNotificationJob[]> {
    const staleBefore = now - 5 * 60_000;
    try {
      await this.db.prepare(
        `UPDATE notification_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL
         WHERE status = 'processing' AND claimed_at <= ?`,
      ).bind(staleBefore).run();
      const due = await this.db.prepare(
        `SELECT id FROM notification_jobs
         WHERE status = 'pending' AND due_at <= ? AND next_attempt_at <= ?
         ORDER BY due_at, id LIMIT ?`,
      ).bind(now, now, Math.min(Math.max(limit, 1), 25)).all<{ id: string }>();
      if (due.results.length === 0) return [];
      const statements = due.results.map(({ id }) => this.db.prepare(
        `UPDATE notification_jobs SET status = 'processing', claim_token = ?, claimed_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).bind(claimToken, now, id));
      await this.db.batch(statements);
      const placeholders = due.results.map(() => "?").join(", ");
      const result = await this.db.prepare(
        `SELECT j.id, j.log_id, j.fast_id, j.subscription_id, j.kind, j.due_at,
                j.status, j.claim_token, j.claimed_at, j.attempted_at, j.attempt_count,
                j.next_attempt_at, j.created_at, s.endpoint, s.p256dh, s.auth,
                s.advance_minutes, f.goal_hours
         FROM notification_jobs j
         JOIN push_subscriptions s ON s.id = j.subscription_id AND s.enabled = 1
         JOIN fasts f ON f.id = j.fast_id AND f.end_at IS NULL AND f.deleted_at IS NULL
         WHERE j.id IN (${placeholders}) AND j.status = 'processing' AND j.claim_token = ?
         ORDER BY j.due_at, j.id`,
      ).bind(...due.results.map(({ id }) => id), claimToken).all<NotificationJobRow>();
      return result.results.map((row) => ({
        id: row.id,
        logId: row.log_id as LogId,
        fastId: row.fast_id as FastId,
        subscriptionId: row.subscription_id,
        kind: row.kind,
        dueAt: asNumber(row.due_at),
        claimToken: row.claim_token!,
        attemptCount: asNumber(row.attempt_count),
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        advanceMinutes: asNumber(row.advance_minutes) as AdvanceMinutes,
        goalHours: asNumber(row.goal_hours),
      }));
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async markSent(job: ClaimedNotificationJob, now: number): Promise<boolean> {
    try {
      const result = await this.db.batch([
        this.db.prepare(
          `UPDATE notification_jobs SET status = 'sent', attempted_at = ?, attempt_count = attempt_count + 1,
             claim_token = NULL WHERE id = ? AND status = 'processing' AND claim_token = ?`,
        ).bind(now, job.id, job.claimToken),
        this.db.prepare(
          `UPDATE push_subscriptions SET last_success_at = ?, failed_at = NULL
           WHERE id = ? AND EXISTS (SELECT 1 FROM notification_jobs WHERE id = ? AND status = 'sent')`,
        ).bind(now, job.subscriptionId, job.id),
      ]);
      return changedRows(result[0]!) === 1;
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async markTransientFailure(job: ClaimedNotificationJob, now: number): Promise<void> {
    const attempts = job.attemptCount + 1;
    const retryAt = now + Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
    try {
      await this.db.prepare(
        `UPDATE notification_jobs
         SET status = CASE WHEN ? >= 5 THEN 'cancelled' ELSE 'pending' END,
             attempted_at = ?, attempt_count = ?, next_attempt_at = ?, claim_token = NULL, claimed_at = NULL
         WHERE id = ? AND status = 'processing' AND claim_token = ?`,
      ).bind(attempts, now, attempts, retryAt, job.id, job.claimToken).run();
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async removePermanentFailure(job: ClaimedNotificationJob, now: number): Promise<void> {
    try {
      await this.db.batch([
        this.db.prepare("UPDATE push_subscriptions SET enabled = 0, failed_at = ? WHERE id = ?").bind(now, job.subscriptionId),
        this.db.prepare(
          "UPDATE notification_jobs SET status = 'cancelled', attempted_at = ?, attempt_count = attempt_count + 1, claim_token = NULL WHERE subscription_id = ? AND status IN ('pending', 'processing')",
        ).bind(now, job.subscriptionId),
      ]);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }
}
