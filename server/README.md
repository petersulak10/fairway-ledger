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

## The API

Every call carries the group's join code in an `x-join-code` header.

| Route | Does |
|---|---|
| `GET /api/hello` | says whether a code is the right one — used by the join prompt |
| `GET /api/state?since=<ms>` | everything changed since a timestamp |
| `POST /api/sync` | send your changes, get everyone else's back |

Writes are last-writer-wins per record: a row only moves if the incoming
`updatedAt` is at least as new as the stored one. Deletions travel as
tombstones so every device learns about them; the app hides them.

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
