/**
 * Fairway Ledger — the whole backend.
 *
 * One Worker serves the app and its data from a single address, backed by a
 * D1 database the whole group shares. Everyone who opens the site sees the
 * same players, rounds and course corrections; there are no group links and
 * no per-browser ledgers.
 *
 * One lock: the group's join code. A browser sends it with every request and
 * remembers it, so friends type it once. Inside the group everyone is
 * trusted — it is a scoreboard among friends, not a bank.
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_RECORDS = 500;                 /* per sync call, so one bad client cannot flood it */

const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: JSON_HEADERS });
const bad = (code, status, extra) => json(Object.assign({ error: code }, extra || {}), status || 400);

/** Compare without leaking length or position through timing. */
function sameSecret(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
const norm = (s) => String(s || "").trim().toLowerCase();

function joinCodeOk(request, env) {
  return sameSecret(norm(request.headers.get("x-join-code")), norm(env.JOIN_CODE));
}

/* ---------- reading ---------- */
async function readState(env, since) {
  const s = Number(since) || 0;
  const [players, rounds, courses] = await Promise.all([
    env.DB.prepare("SELECT id, name, body, updated_at, deleted FROM players WHERE updated_at > ?").bind(s).all(),
    env.DB.prepare("SELECT id, player_id, body, updated_at, deleted FROM rounds WHERE updated_at > ?").bind(s).all(),
    env.DB.prepare("SELECT id, body, updated_at, deleted FROM courses WHERE updated_at > ?").bind(s).all()
  ]);
  const unpack = (row, extra) => {
    let body = {};
    try { body = JSON.parse(row.body) || {}; } catch (e) { /* a bad row must not break a sync */ }
    return Object.assign(body, { id: row.id, updatedAt: row.updated_at }, row.deleted ? { deleted: true } : {}, extra || {});
  };
  return {
    now: Date.now(),
    players: (players.results || []).map(r => unpack(r, { name: r.name })),
    rounds: (rounds.results || []).map(r => unpack(r, { playerId: r.player_id })),
    courses: (courses.results || []).map(r => unpack(r))
  };
}

/* ---------- writing ---------- */
function bodyOf(rec, drop) {
  const body = Object.assign({}, rec);
  ["id", "updatedAt", "deleted"].concat(drop || []).forEach(k => delete body[k]);
  return JSON.stringify(body);
}

async function applyWrites(env, payload) {
  const now = Date.now();
  const stmts = [];
  const take = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_RECORDS);

  for (const p of take(payload.players)) {
    if (!p || !p.id) continue;
    stmts.push(env.DB.prepare(
      "INSERT INTO players (id, name, body, updated_at, deleted) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, body = excluded.body, " +
      "updated_at = excluded.updated_at, deleted = excluded.deleted " +
      "WHERE excluded.updated_at >= players.updated_at")
      .bind(p.id, String(p.name || "").slice(0, 80), bodyOf(p, ["name"]), now, p.deleted ? 1 : 0));
  }
  for (const r of take(payload.rounds)) {
    if (!r || !r.id || !r.playerId) continue;
    stmts.push(env.DB.prepare(
      "INSERT INTO rounds (id, player_id, body, updated_at, deleted) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET player_id = excluded.player_id, body = excluded.body, " +
      "updated_at = excluded.updated_at, deleted = excluded.deleted " +
      "WHERE excluded.updated_at >= rounds.updated_at")
      .bind(r.id, r.playerId, bodyOf(r, ["playerId"]), now, r.deleted ? 1 : 0));
  }
  for (const c of take(payload.courses)) {
    if (!c || !c.id) continue;
    stmts.push(env.DB.prepare(
      "INSERT INTO courses (id, body, updated_at, deleted) VALUES (?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, " +
      "deleted = excluded.deleted WHERE excluded.updated_at >= courses.updated_at")
      .bind(c.id, bodyOf(c), now, c.deleted ? 1 : 0));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

/* ---------- routes ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* Everything that is not the API is the app itself. */
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    if (!env.DB) return bad("database_not_bound", 500);

    /* Check a join code without being in the group yet. */
    if (url.pathname === "/api/hello") {
      return json({ ok: true, group: joinCodeOk(request, env) });
    }
    if (!joinCodeOk(request, env)) return bad("bad_join_code", 401);

    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(await readState(env, url.searchParams.get("since")));
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return bad("not_json");
      const written = await applyWrites(env, payload);
      const state = await readState(env, payload.since);
      return json(Object.assign(state, { written }));
    }

    return bad("not_found", 404);
  }
};
