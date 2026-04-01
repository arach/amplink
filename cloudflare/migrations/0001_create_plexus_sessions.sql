CREATE TABLE IF NOT EXISTS plexus_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_plexus_sessions_user_updated
ON plexus_sessions (user_id, updated_at DESC);

