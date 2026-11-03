PRAGMA foreign_keys = OFF;

CREATE TABLE push_subscriptions_new (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  advance_enabled INTEGER NOT NULL DEFAULT 1 CHECK (advance_enabled IN (0, 1)),
  advance_minutes INTEGER NOT NULL DEFAULT 30 CHECK (advance_minutes IN (15, 30, 60)),
  goal_enabled INTEGER NOT NULL DEFAULT 1 CHECK (goal_enabled IN (0, 1)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  last_success_at INTEGER CHECK (last_success_at IS NULL OR last_success_at >= 0),
  failed_at INTEGER CHECK (failed_at IS NULL OR failed_at >= 0),
  UNIQUE (log_id, device_id)
);

INSERT INTO push_subscriptions_new (
  id, log_id, device_id, endpoint, p256dh, auth, enabled, advance_minutes,
  created_at, last_success_at, failed_at
)
SELECT id, log_id, device_id, endpoint, p256dh, auth, enabled, advance_minutes,
       created_at, last_success_at, failed_at
FROM push_subscriptions;

DROP TABLE notification_jobs;
DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

CREATE TABLE notification_jobs (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  fast_id TEXT NOT NULL REFERENCES fasts(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('advance', 'goal')),
  due_at INTEGER NOT NULL CHECK (due_at >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'cancelled')),
  claim_token TEXT,
  claimed_at INTEGER CHECK (claimed_at IS NULL OR claimed_at >= 0),
  attempted_at INTEGER CHECK (attempted_at IS NULL OR attempted_at >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (subscription_id, fast_id, kind)
);
CREATE INDEX notification_jobs_status_due_idx ON notification_jobs(status, next_attempt_at, due_at);

PRAGMA foreign_keys = ON;
