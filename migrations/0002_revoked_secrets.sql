CREATE TABLE revoked_secrets (
  digest_marker TEXT PRIMARY KEY CHECK (length(digest_marker) = 43),
  revoked_at INTEGER NOT NULL CHECK (revoked_at >= 0)
);
