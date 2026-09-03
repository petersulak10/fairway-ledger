-- Photos attached to a round. The picture itself lives in KV; this is the index.
CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,       -- also the unguessable URL for the image
  round_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_photos_round   ON photos(round_id);
CREATE INDEX IF NOT EXISTS idx_photos_updated ON photos(updated_at);
