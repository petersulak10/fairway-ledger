-- Fairway Ledger — one shared database for the whole group.

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,           -- the rest of the player record, as JSON
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rounds (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS courses (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);


CREATE INDEX IF NOT EXISTS idx_rounds_player  ON rounds(player_id);
CREATE INDEX IF NOT EXISTS idx_rounds_updated ON rounds(updated_at);
CREATE INDEX IF NOT EXISTS idx_players_updated ON players(updated_at);
CREATE INDEX IF NOT EXISTS idx_courses_updated ON courses(updated_at);
