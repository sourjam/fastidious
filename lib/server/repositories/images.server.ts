import type { ImageAssetId, LogId } from "../../domain/types";
import { asNumber } from "../db.server";
import { RepositoryError } from "../errors.server";

export interface ImageAssetRecord {
  id: ImageAssetId;
  logId: LogId | null;
  uploadKey: string;
  status: "uploaded" | "attached" | "pending_delete";
  width: number;
  height: number;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
  deleteAfter: number | null;
}

export class ImageAssetRepository {
  constructor(private readonly db: D1Database) {}

  async findByUploadKey(logId: LogId, uploadKey: string): Promise<ImageAssetRecord | null> {
    const row = await this.db.prepare("SELECT * FROM image_assets WHERE log_id = ? AND upload_key = ?")
      .bind(logId, uploadKey).first<Record<string, unknown>>();
    return row ? map(row) : null;
  }

  async countForLog(logId: LogId): Promise<number> {
    return asNumber(await this.db.prepare("SELECT COUNT(*) AS count FROM image_assets WHERE log_id = ? AND status != 'pending_delete'")
      .bind(logId).first<number>("count") ?? 0);
  }

  async countRecent(logId: LogId, since: number): Promise<number> {
    return asNumber(await this.db.prepare("SELECT COUNT(*) AS count FROM image_assets WHERE log_id = ? AND created_at >= ?")
      .bind(logId, since).first<number>("count") ?? 0);
  }

  async create(input: { id: ImageAssetId; logId: LogId; uploadKey: string; width: number; height: number; byteSize: number; now: number }): Promise<ImageAssetRecord> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO image_assets (id, log_id, upload_key, status, width, height, byte_size, created_at, updated_at, delete_after)
       VALUES (?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?)`,
    ).bind(input.id, input.logId, input.uploadKey, input.width, input.height, input.byteSize, input.now, input.now, input.now + 24 * 60 * 60 * 1_000).run();
    const saved = await this.findByUploadKey(input.logId, input.uploadKey);
    if (!saved) throw new RepositoryError("transient_database_failure", "Image metadata could not be saved.");
    return saved;
  }

  async requireOwned(logId: LogId, assetId: string): Promise<ImageAssetRecord> {
    const row = await this.db.prepare("SELECT * FROM image_assets WHERE id = ? AND log_id = ? AND status != 'pending_delete'")
      .bind(assetId, logId).first<Record<string, unknown>>();
    if (!row) throw new RepositoryError("not_found", "Image was not found.");
    return map(row);
  }

  async listPendingDeletion(now: number, limit = 25): Promise<ImageAssetRecord[]> {
    const result = await this.db.prepare("SELECT * FROM image_assets WHERE status IN ('uploaded', 'pending_delete') AND delete_after <= ? ORDER BY delete_after LIMIT ?")
      .bind(now, limit).all<Record<string, unknown>>();
    return result.results.map(map);
  }

  async removeDeleted(id: ImageAssetId): Promise<void> {
    await this.db.prepare("DELETE FROM image_assets WHERE id = ? AND status IN ('uploaded', 'pending_delete')").bind(id).run();
  }
}

function map(row: Record<string, unknown>): ImageAssetRecord {
  return {
    id: String(row.id) as ImageAssetId,
    logId: row.log_id === null ? null : String(row.log_id) as LogId,
    uploadKey: String(row.upload_key),
    status: String(row.status) as ImageAssetRecord["status"],
    width: asNumber(row.width),
    height: asNumber(row.height),
    byteSize: asNumber(row.byte_size),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
    deleteAfter: row.delete_after === null ? null : asNumber(row.delete_after),
  };
}
