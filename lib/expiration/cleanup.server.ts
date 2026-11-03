import { CleanupRepository } from "../server/repositories/cleanup.server";
import { LogRepository } from "../server/repositories/logs.server";

export const EXPIRATION_BATCH_SIZE = 25;
export const EXPIRED_MARKER_RETENTION_MS = 60 * 24 * 60 * 60 * 1_000;

export async function expireInactiveLogs(
  db: D1Database,
  now = Date.now(),
  limit = EXPIRATION_BATCH_SIZE,
  markerRetentionMs = EXPIRED_MARKER_RETENTION_MS,
): Promise<{ expired: number; markersPurged: number }> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const logs = new LogRepository(db);
  const due = await logs.listDueForExpiration(now, boundedLimit);
  let expired = 0;
  for (const log of due) {
    if (await logs.expire(log.id, now, now + markerRetentionMs)) expired += 1;
  }
  const markersPurged = await new CleanupRepository(db).purgeExpiredMarkers(now, boundedLimit);
  return { expired, markersPurged };
}
