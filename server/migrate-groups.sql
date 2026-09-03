-- Many groups, and a player who can belong to several.
--
-- A player is a global identity: one name, one PIN, one handicap, one set of
-- rounds. A group is a circle of people who see each other. Memberships join
-- the two, and carry the admin flag — you can run one group and simply play
-- in another.

CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  join_code  TEXT NOT NULL,           -- lower-cased; what you send friends
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_code ON groups(join_code);

CREATE TABLE IF NOT EXISTS memberships (
  id         TEXT PRIMARY KEY,        -- group_id + "|" + player_id
  group_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memberships_group  ON memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_memberships_player ON memberships(player_id);
