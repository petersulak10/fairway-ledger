-- An admin for the group, and comments on rounds.
ALTER TABLE players ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  round_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,          -- who wrote it
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_round   ON comments(round_id);
CREATE INDEX IF NOT EXISTS idx_comments_updated ON comments(updated_at);
