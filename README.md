# Fairway Ledger

**Live: https://petersulak10.github.io/fairway-ledger/**

A golf round tracker for you and your friends. One file, no build step, no
accounts, no sign-in, nothing to pay for.

Run it locally instead with:

```bash
open "/Users/petersulak/Claude Code Tests/golf-tracker/index.html"
```

Deploying is just pushing to `main` — GitHub Pages serves `index.html` straight
from the repository root.

## What it does

- **Hole-by-hole entry** for one player or a fourball at once — shots, putts,
  fairway hit, green in regulation, with running gross, to-par and Stableford.
- **A course book of 21,031 real courses** in 59 countries, filed **continent →
  country → city → club → course**, with a type-ahead search and a browse tree.
- **Real handicap maths** — World Handicap System: course handicap, strokes
  allocated by stroke index, Stableford under net double bogey, score
  differentials, and an index from the best 8 of your last 20 rounds.
- **A printed scorecard view** per round with birdie/bogey ring marks.
- **Group leaderboard**, per-player index trend and score distribution.
- **Import** from CSV, **export** to CSV or JSON.

## How the course book works

The bundled book carries **names and locations only** — 21,031 courses in 59
countries. The scorecard itself (tees, course rating, slope, hole pars, stroke
index) is fetched the first time somebody actually picks that course, then kept
for good. That keeps the page at 290 KB over the wire while making every course
findable.

On top of the bundled book, searching also queries the open database live, so
courses that were never bundled show up under **More courses** and can be added
with one tap. Both of those need a connection, so neither runs inside the Claude
artifact viewer, which allows no outside requests — there, the bundled book is
searched offline and nothing else happens.

Nothing is invented. Every rating is either published by a governing body or
absent, and the app says which.

| Region | Source | What you get |
|---|---|---|
| **United Arab Emirates** | [Emirates Golf Federation](https://egfgolf.ae/course-ratings/) | All 21 clubs, 26 course set-ups, **official rating and slope on all four tees** |
| **Czechia** | [Czech Golf Federation](https://www.cgf.cz/cz/hriste/hriste-vyhledavani&holesCount=18) register | All 105 registered courses with the right town and region |
| **Slovakia** | [Slovak Golf Association](https://www.skga.sk/kde-hrat/) register | All 23 registered courses |
| **United States** | [OpenGolfAPI](https://opengolfapi.org) / OpenStreetMap (ODbL 1.0) | 13,997 courses; 213 with real hole cards, 167 with published rating and slope |
| **Rest of world** | OpenStreetMap via Overpass, plus a hand-checked list | 6,545 courses placed by their own coordinates |

A federation rating is never overwritten by the open database — official numbers
win.

**A trap worth knowing about.** Harvesting OpenStreetMap by bounding box picks up
neighbours: rectangles are not borders, so courses near Prague arrived inside the
German and Polish boxes. Every harvested course is therefore re-placed by its own
coordinates against Natural Earth boundaries (`geocode.py`) — that moved 2,928 of
them into the right country. Coastal courses that the simplified coastline misses
fall back to the nearest country within 75 km.

**Filling in more ratings.** OpenGolfAPI is free and keyless but caps anonymous
callers at a few hundred lookups a day. Ratings arrive on demand as you use the
app; to pull a batch up front:

```bash
python3 harvest.py && python3 build_dataset.py && python3 embed_data.py
```

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

**No invented hole cards.** Until a real card is fetched or typed in, hole pars
and stroke indexes are a standard template, flagged in the app as "card
unchecked". Correct them once and mark the course checked.

## Sharing one ledger with friends

Settings → **Share with the group** gives you a link. Anyone who joins with it
reads and writes the same scoreboard, and it merges per record, newest wins.

Two places that scoreboard can live:

**Your own server (recommended).** Deploy the Cloudflare Worker in `worker/` —
free, about five minutes, no card — paste its address into
Settings → *Keep it on your own server*, and the group lives on an endpoint you
control, with an **Erase for everyone** button. See [worker/README.md](worker/README.md).

**A free public store.** Leave that field empty and the group goes to
jsonblob.com. Works with no setup, but it is a stranger's free service: no
password, and I have not verified its retention policy.

Either way the link is the credential — anyone holding it can read and edit, so
send it by DM, not on a public page. Neither works inside the Claude artifact
viewer, which allows no outside requests; use a hosted copy for sharing.

What actually syncs: players (name, optional starting handicap), rounds and any
course corrections. What never leaves the device: which player you are, the
group link itself, and an unsaved card.

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
| `worker/` | the optional Cloudflare Worker for group sync, and its guide |

Data lives in this browser's `localStorage`; the catalogue is read-only and
anything you edit is stored separately as an override. Clearing site data erases
your rounds, so keep a backup from Settings → Backup.
