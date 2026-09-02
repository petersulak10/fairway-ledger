-- Adds per-player PINs to a database created before they existed.
ALTER TABLE players ADD COLUMN pin_hash TEXT;
ALTER TABLE players ADD COLUMN pin_salt TEXT;
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
