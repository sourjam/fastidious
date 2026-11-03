CREATE TABLE image_assets (
  id TEXT PRIMARY KEY,
  log_id TEXT REFERENCES logs(id) ON DELETE SET NULL,
  upload_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'attached', 'pending_delete')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  delete_after INTEGER
);

CREATE INDEX image_assets_log_status_idx ON image_assets(log_id, status);
CREATE INDEX image_assets_delete_idx ON image_assets(status, delete_after);
CREATE INDEX image_assets_created_idx ON image_assets(log_id, created_at);
