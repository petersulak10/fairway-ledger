-- Fairway Ledger — one shared database for the whole group.

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  pin_hash   TEXT,                    -- null until somebody claims this name
  pin_salt   TEXT,
  is_admin   INTEGER NOT NULL DEFAULT 0,
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

-- A signed-in device. One row per device that claimed or signed in to a player.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);

-- Comments the group leaves on each other's rounds.
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  round_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_round   ON comments(round_id);
CREATE INDEX IF NOT EXISTS idx_comments_updated ON comments(updated_at);
