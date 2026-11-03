import { asNumber, changedRows } from "../db.server";
import { databaseFailure } from "../errors.server";

interface ExpiredLogRow {
  digest_marker: string;
  expired_at: number;
  purge_after: number;
}

export interface ExpiredLogRecord {
  digestMarker: string;
  expiredAt: number;
  purgeAfter: number;
}

export class CleanupRepository {
  constructor(private readonly db: D1Database) {}

  async listExpiredMarkersDueForPurge(now: number, limit = 100): Promise<ExpiredLogRecord[]> {
    try {
      const result = await this.db
        .prepare(
          `SELECT digest_marker, expired_at, purge_after FROM expired_logs
           WHERE purge_after <= ? ORDER BY purge_after LIMIT ?`,
        )
        .bind(now, limit)
        .all<ExpiredLogRow>();
      return result.results.map((row) => ({
        digestMarker: row.digest_marker,
        expiredAt: asNumber(row.expired_at),
        purgeAfter: asNumber(row.purge_after),
      }));
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }

  async purgeExpiredMarkers(now: number, limit = 100): Promise<number> {
    try {
      const result = await this.db
        .prepare(
          `DELETE FROM expired_logs WHERE digest_marker IN (
             SELECT digest_marker FROM expired_logs WHERE purge_after <= ? ORDER BY purge_after LIMIT ?
           )`,
        )
        .bind(now, limit)
        .run();
      return changedRows(result);
    } catch (cause) {
      throw databaseFailure(cause);
    }
  }
}
