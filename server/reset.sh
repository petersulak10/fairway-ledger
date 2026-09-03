#!/bin/zsh
# Wipe the group's contents — players, rounds, comments, photos, course edits.
#
# Deletions MUST bump updated_at. A device only asks for rows changed since it
# last synced, so a tombstone with an old timestamp is never delivered and the
# deleted rows live on in every browser that had already seen them. That is
# exactly how three Peters and a Probe ended up on a phone.
set -e
cd "$(dirname "$0")"
NOW=$(python3 -c 'import time;print(int(time.time()*1000))')
npx --prefix ../worker wrangler d1 execute fairway-ledger --remote -y --command "
UPDATE players  SET deleted = 1, updated_at = $NOW, pin_hash = NULL, pin_salt = NULL, is_admin = 0;
UPDATE rounds   SET deleted = 1, updated_at = $NOW;
UPDATE comments SET deleted = 1, updated_at = $NOW;
UPDATE photos   SET deleted = 1, updated_at = $NOW;
UPDATE courses  SET deleted = 1, updated_at = $NOW;
DELETE FROM sessions;
"
echo "Group emptied. Every device drops these on its next sync."
