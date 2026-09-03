# Fairway Ledger — the backend

One Cloudflare Pages project serves the app **and** its API from a single
address, with a D1 database behind it. Every player reads and writes the same
database, so everyone sees everyone — no group links, no per-browser ledgers.

| | |
|---|---|
| Address | https://fairwayledger-1o6.pages.dev/ |
| Database | D1, `fairway-ledger` (`55d366ec-b38b-40dd-a108-3520af1f6b96`) |
| Cost | £0 — free plan covers 5 GB, 5M reads/day, 100k writes/day |

## How it fits together

```
dist/index.html   the app
dist/_worker.js   anything under /api/ ; everything else is served as an asset
schema.sql        the three tables
```

`_worker.js` is a copy of `worker.js`, made at deploy time by `deploy.sh` —
edit `worker.js`, never `dist/`.

## Two locks

**The join code** decides who is in the group at all. Every call carries it in
an `x-join-code` header.

**A player's PIN** makes their card theirs. Claim a name with a PIN and from
then on only a device holding it can change that player or their rounds — the
device sends an `x-player-token` alongside the join code. Names nobody has
claimed stay open on purpose, so you can keep a card for a friend who has not
joined yet. The course book is common ground for the whole group.

PINs are stored as a salted SHA-256, not a slow KDF. Two honest reasons: the
free plan allows 10ms of CPU per request and PBKDF2 blows straight through it
(the first deploy failed with error 1101 for exactly that), and a four-digit
PIN is 10,000 guesses, so no hash saves it if the database leaks. The PIN stops
one group member editing another's card; the join code is the real perimeter.

## The admin

The first player to claim a card runs the group. An admin can remove a player,
clear a forgotten PIN, and make somebody else an admin — and can edit anybody's
card, which is how a mistake gets fixed. There is always at least one admin: the
last one cannot step down until somebody else is promoted.

Removing a player soft-deletes them together with their rounds and comments, so
nothing is really gone from the database — it just stops appearing.

**A trap worth remembering.** Admin actions originally reset the client's sync
marker and then ran a full sync, which pushed the device's stale copy of the
removed player straight back up and revived them. Anything that changes the
group from the server side must pull without pushing (`refreshAll`).

## Comments

Anyone signed in can comment on any round. You may delete your own; an admin may
delete any. Comments sync like every other record and are capped at 1,000
characters server-side.

## Photos

Pictures live in a KV namespace (`PHOTOS`), indexed by a `photos` table in D1.
The browser shrinks each one to 1600px JPEG before uploading — a phone photo
goes from megabytes to roughly 25 KB — so the free tier's 1 GB holds thousands.

Serving is deliberately unauthenticated: an `<img>` tag cannot send a header,
so a photo's own 32-character id is what protects it, exactly like the group
link. Uploading needs both the join code and a signed-in player.

R2 would be the natural home and has a bigger free tier, but it must be
enabled in the dashboard and Cloudflare asks for a card on file. KV was
already available, so photos need nothing switched on.

## The API

| Route | Does |
|---|---|
| `GET /api/hello` | says whether a code is the right one — used by the join prompt |
| `GET /api/state?since=<ms>` | everything changed since a timestamp |
| `POST /api/sync` | send your changes, get everyone else's back; refused ids come back in `refused` |
| `POST /api/claim` | claim a name with a PIN, returns a token |
| `POST /api/signin` | same player, another device |
| `POST /api/signout` | drop this device's token |
| `POST /api/admin/remove-player` | admin only: remove a player, their rounds and comments |
| `POST /api/admin/clear-pin` | admin only: release a card whose PIN was forgotten |
| `POST /api/admin/set-admin` | admin only: promote or demote somebody |
| `POST /api/photo?roundId=` | upload a picture (signed in); returns its id |
| `GET /photo/:id` | the picture itself — no header, the id is the key |

Writes are last-writer-wins per record: a row only moves if the incoming
`updatedAt` is at least as new as the stored one. Deletions travel as
tombstones so every device learns about them; the app hides them.

## Clearing a forgotten PIN

There is no recovery by design. To release a card:

```bash
cd server && npx --prefix ../worker wrangler d1 execute fairway-ledger --remote \
  --command "UPDATE players SET pin_hash=NULL, pin_salt=NULL WHERE name='Tomas'"
```

The card becomes unclaimed and can be claimed again with a new PIN.

## Changing the join code

Edit `JOIN_CODE` in `server/wrangler.toml` and redeploy. Everyone is asked for
the new one the next time their browser syncs, which is how you remove someone
who should no longer be in the group.

## Changing the schema

```bash
cd server && npx --prefix ../worker wrangler d1 execute fairway-ledger --remote --file=./schema.sql -y
```

The file is written so it can be re-run safely.

## Looking at the data

```bash
cd server && npx --prefix ../worker wrangler d1 execute fairway-ledger --remote \
  --command "SELECT name, updated_at FROM players WHERE deleted = 0"
```
