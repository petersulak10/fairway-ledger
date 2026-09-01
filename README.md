# Fairway Ledger

A golf round tracker for you and your friends. One file, no build step, no
accounts, no sign-in, nothing to pay for.

```bash
open "/Users/petersulak/Claude Code Tests/golf-tracker/index.html"
```

That is the whole install. It also runs from any static host, and there is a
published copy on claude.ai.

## What it does

- **Hole-by-hole entry** for one player or a fourball at once — shots, putts,
  fairway hit, green in regulation, with running gross, to-par and Stableford.
- **A course book of 14,375 real courses** filed **continent → country → city →
  club → course**, with a type-ahead search and a browse tree.
- **Real handicap maths** — World Handicap System: course handicap, strokes
  allocated by stroke index, Stableford under net double bogey, score
  differentials, and an index from the best 8 of your last 20 rounds.
- **A printed scorecard view** per round with birdie/bogey ring marks.
- **Group leaderboard**, per-player index trend and score distribution.
- **Import** from CSV, **export** to CSV or JSON.

## Where the course data comes from

Nothing here is invented. Every rating is either published by a governing body
or absent, and the app says which.

| Region | Source | What you get |
|---|---|---|
| **United Arab Emirates** | [Emirates Golf Federation](https://egfgolf.ae/course-ratings/) official rating tables | All 21 clubs, 26 course configurations, **official rating and slope for all four tees** |
| **United States** | [OpenGolfAPI](https://opengolfapi.org) / OpenStreetMap contributors (ODbL 1.0) | 13,997 courses with names, cities and states; 213 with real hole cards (par + stroke index); 167 with published rating and slope |
| **Rest of world** | Hand-checked list | 139 well-known clubs with correct locations and pars |

Where a rating is missing the app falls back to the neutral WHS values
(slope 113, rating = par) and tells you so on the card — a course handicap then
equals the handicap index. Copy the two numbers off the scorecard once and every
past round on that course recalculates.

**Filling in more ratings.** OpenGolfAPI is free and keyless but caps anonymous
callers at a few hundred lookups a day, which is why only 167 courses carry
ratings so far. Two ways to add more:

- In the app (hosted copies only — the Claude artifact sandbox blocks outside
  requests): open a course and press **Look up a published rating**.
- In bulk, resumably, a few hundred a day:

```bash
python3 harvest.py && python3 build_dataset.py && python3 embed_data.py
```

If you want the lot at once, a free OpenGolfAPI key takes about a minute at
opengolfapi.org/developer and lifts the cap — that is an account signup, so it
is your call, not something I did for you.

I deliberately did **not** scrape golfhandicapcalculator.co, which has published
ratings for ~100 countries: its robots.txt disallows ClaudeBot outright.

## The three things it deliberately does not do

**No sign-in.** Everyone using a given browser shares that browser's ledger;
"who are you" only decides whose card opens first. Real Google sign-in would
mean registering a Google Cloud OAuth client and running a server.

**No automatic Garmin sync.** Garmin puts golf scorecards behind the
[Golf Premium API](https://developer.garmin.com/golf-api/), an approved
commercial programme with pricing, and it needs a server. Instead: export from
Garmin Golf and drop the CSV into Settings → Garmin & scorecard import. Any CSV
with a date column and eighteen hole columns (`1…18`, `H1…H18` or
`Hole 1…Hole 18`) is read.

**No invented hole cards.** Outside the 153 courses with a real card, hole pars
and stroke indexes are a standard template, flagged in the app as "card
unchecked". Correct them once and mark the course checked.

## Sharing one ledger with friends

Settings → **Share with the group** creates a shared JSON document at
jsonblob.com (no account, no key) and gives you a link. Anyone who joins with
that link reads and writes the same ledger.

- **The link is the key** — anyone holding it can read and edit.
- **It cannot run inside the Claude artifact viewer**, which blocks outside
  network calls. Use a self-hosted copy for group sync.
- Not tested end to end against the live service — that would have published
  data to a third-party host without asking. Your first "Create a group link"
  will confirm it.

## Files

| File | What it is |
|---|---|
| `index.html` | the entire app, catalogue included |
| `check.js` | syntax-checks the script blocks (`node check.js`) |
| `harvest.py` | tops up US ratings from OpenGolfAPI; resumable |
| `build_dataset.py` | merges every source into `data/courses.psv` |
| `curated.py` | the hand-checked worldwide list |
| `embed_data.py` | embeds `data/courses.psv` into `index.html` |
| `data/` | the raw sources and the packed catalogue |

Data lives in this browser's `localStorage`; the catalogue is read-only and
anything you edit is stored separately as an override. Clearing site data erases
your rounds, so keep a backup from Settings → Backup.
