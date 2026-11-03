PRAGMA foreign_keys = ON;

CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  secret_digest TEXT NOT NULL UNIQUE CHECK (length(secret_digest) = 43),
  credential_generation INTEGER NOT NULL DEFAULT 1 CHECK (credential_generation >= 1),
  data_generation INTEGER NOT NULL DEFAULT 1 CHECK (data_generation >= 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  timezone TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  weight_unit TEXT NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg', 'lb')),
  default_goal_hours REAL NOT NULL DEFAULT 16 CHECK (default_goal_hours >= 1 AND default_goal_hours <= 168 AND default_goal_hours * 2 = CAST(default_goal_hours * 2 AS INTEGER)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  last_access_at INTEGER NOT NULL CHECK (last_access_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0)
);
CREATE INDEX logs_expires_at_idx ON logs(expires_at);

CREATE TABLE fasts (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  start_at INTEGER NOT NULL CHECK (start_at >= 0),
  end_at INTEGER CHECK (end_at IS NULL OR end_at > start_at),
  goal_hours REAL NOT NULL CHECK (goal_hours >= 1 AND goal_hours <= 168 AND goal_hours * 2 = CAST(goal_hours * 2 AS INTEGER)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX fasts_log_start_idx ON fasts(log_id, start_at);
CREATE INDEX fasts_log_revision_deleted_idx ON fasts(log_id, revision, deleted_at);
CREATE UNIQUE INDEX fasts_one_active_per_log_idx ON fasts(log_id) WHERE end_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER fasts_reject_overlap_insert
BEFORE INSERT ON fasts
WHEN NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM fasts existing
  WHERE existing.log_id = NEW.log_id
    AND existing.deleted_at IS NULL
    AND NEW.start_at < COALESCE(existing.end_at, 9223372036854775807)
    AND existing.start_at < COALESCE(NEW.end_at, 9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT, 'fast_overlap');
END;

CREATE TRIGGER fasts_reject_overlap_update
BEFORE UPDATE OF log_id, start_at, end_at, deleted_at ON fasts
WHEN NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM fasts existing
  WHERE existing.log_id = NEW.log_id
    AND existing.id <> NEW.id
    AND existing.deleted_at IS NULL
    AND NEW.start_at < COALESCE(existing.end_at, 9223372036854775807)
    AND existing.start_at < COALESCE(NEW.end_at, 9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT, 'fast_overlap');
END;

CREATE TABLE weights (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  measured_at INTEGER NOT NULL CHECK (measured_at >= 0),
  kilograms REAL NOT NULL CHECK (kilograms > 0 AND kilograms <= 1000),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
CREATE INDEX weights_log_measured_idx ON weights(log_id, measured_at);
CREATE INDEX weights_log_revision_deleted_idx ON weights(log_id, revision, deleted_at);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  advance_minutes INTEGER NOT NULL DEFAULT 30 CHECK (advance_minutes IN (15, 30, 60)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  last_success_at INTEGER CHECK (last_success_at IS NULL OR last_success_at >= 0),
  failed_at INTEGER CHECK (failed_at IS NULL OR failed_at >= 0),
  UNIQUE (log_id, device_id)
);

CREATE TABLE notification_jobs (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  fast_id TEXT NOT NULL REFERENCES fasts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('advance', 'goal')),
  due_at INTEGER NOT NULL CHECK (due_at >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'cancelled')),
  claimed_at INTEGER CHECK (claimed_at IS NULL OR claimed_at >= 0),
  attempted_at INTEGER CHECK (attempted_at IS NULL OR attempted_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (fast_id, kind)
);
CREATE INDEX notification_jobs_status_due_idx ON notification_jobs(status, due_at);

CREATE TABLE mutation_receipts (
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  applied_revision INTEGER NOT NULL CHECK (applied_revision >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (log_id, mutation_id)
) WITHOUT ROWID;

CREATE TABLE changes (
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('fast', 'weight', 'preferences', 'generation')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'reset')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (log_id, revision)
) WITHOUT ROWID;
CREATE INDEX changes_log_revision_idx ON changes(log_id, revision);

CREATE TABLE expired_logs (
  digest_marker TEXT PRIMARY KEY CHECK (length(digest_marker) = 43),
  expired_at INTEGER NOT NULL CHECK (expired_at >= 0),
  purge_after INTEGER NOT NULL CHECK (purge_after >= expired_at)
);
CREATE INDEX expired_logs_expired_at_idx ON expired_logs(expired_at);
CREATE INDEX expired_logs_purge_after_idx ON expired_logs(purge_after);
