/**
 * Fairway Ledger — the whole backend.
 *
 * One Worker serves the app and its data from a single address, backed by a
 * D1 database the whole group shares. Everyone who opens the site sees the
 * same players, rounds and course corrections; there are no group links and
 * no per-browser ledgers.
 *
 * Two locks, doing different jobs:
 *   • the group's join code, sent with every request, which decides who is
 *     in the group at all;
 *   • a per-player PIN, which makes a player's card theirs. Claim a name with
 *     a PIN and from then on only a device holding that PIN can change that
 *     player or their rounds.
 *
 * Names nobody has claimed stay open on purpose: you need to be able to keep
 * a card for a friend who has not joined yet. The course book is common
 * ground for everyone in the group.
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_RECORDS = 500;                 /* per sync call, so one bad client cannot flood it */
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 365;   /* a year; this is a golf app */

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

/* ---------- PINs and tokens ---------- */
const b64url = (bytes) => btoa(String.fromCharCode.apply(null, new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function randomToken(len) {
  const b = new Uint8Array(len || 32);
  crypto.getRandomValues(b);
  return b64url(b);
}

/**
 * Salted SHA-256, not a slow KDF.
 *
 * The free plan allows 10ms of CPU per request and PBKDF2 is deliberately
 * far heavier than that, so a stretched hash simply cannot run here. It
 * would buy little anyway: a four-digit PIN is 10,000 guesses, which any
 * attacker holding the database cracks whatever the hash. The PIN's real
 * job is to stop one group member editing another's card; the join code is
 * what keeps strangers out. Longer PINs are allowed for anyone who wants
 * the extra room.
 */
async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(salt + "|" + String(pin));
  return b64url(await crypto.subtle.digest("SHA-256", data));
}

async function sessionOf(request, env) {
  const token = request.headers.get("x-player-token");
  if (!token) return null;
  const row = await env.DB.prepare("SELECT token, player_id, created_at FROM sessions WHERE token = ?")
    .bind(token).first();
  if (!row) return null;
  if (Date.now() - row.created_at > TOKEN_TTL) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return row;
}

function joinCodeOk(request, env) {
  return sameSecret(norm(request.headers.get("x-join-code")), norm(env.JOIN_CODE));
}

/* ---------- reading ---------- */
async function readState(env, since) {
  const s = Number(since) || 0;
  const [players, rounds, courses] = await Promise.all([
    env.DB.prepare("SELECT id, name, body, updated_at, deleted, (pin_hash IS NOT NULL) AS claimed FROM players WHERE updated_at > ?").bind(s).all(),
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
    players: (players.results || []).map(r => unpack(r, { name: r.name, claimed: !!r.claimed })),
    rounds: (rounds.results || []).map(r => unpack(r, { playerId: r.player_id })),
    courses: (courses.results || []).map(r => unpack(r))
  };
}

/* ---------- writing ---------- */
function bodyOf(rec, drop) {
  const body = Object.assign({}, rec);
  ["id", "updatedAt", "deleted", "claimed"].concat(drop || []).forEach(k => delete body[k]);
  return JSON.stringify(body);
}

async function applyWrites(env, payload, session) {
  const now = Date.now();
  const stmts = [];
  const refused = [];
  const take = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_RECORDS);
  const mine = session ? session.player_id : null;

  /* Which of the players being touched are already claimed, and by whom. */
  const touched = new Set();
  take(payload.players).forEach(p => p && p.id && touched.add(p.id));
  take(payload.rounds).forEach(r => r && r.playerId && touched.add(r.playerId));
  const claimed = new Set();
  if (touched.size) {
    const ids = Array.from(touched);
    const rows = await env.DB.prepare(
      "SELECT id FROM players WHERE pin_hash IS NOT NULL AND id IN (" +
      ids.map(() => "?").join(",") + ")").bind(...ids).all();
    (rows.results || []).forEach(r => claimed.add(r.id));
  }
  /* A claimed card may only be written by the device holding its PIN. */
  const mayWrite = (playerId) => !claimed.has(playerId) || playerId === mine;

  for (const p of take(payload.players)) {
    if (!p || !p.id) continue;
    if (!mayWrite(p.id)) { refused.push(p.id); continue; }
    stmts.push(env.DB.prepare(
      "INSERT INTO players (id, name, body, updated_at, deleted) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, body = excluded.body, " +
      "updated_at = excluded.updated_at, deleted = excluded.deleted " +
      "WHERE excluded.updated_at >= players.updated_at")
      .bind(p.id, String(p.name || "").slice(0, 80), bodyOf(p, ["name"]), now, p.deleted ? 1 : 0));
  }
  for (const r of take(payload.rounds)) {
    if (!r || !r.id || !r.playerId) continue;
    if (!mayWrite(r.playerId)) { refused.push(r.id); continue; }
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
  return { written: stmts.length, refused };
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

    /* Claim a name with a PIN — either one already in the group, or a new one. */
    if (url.pathname === "/api/claim" && request.method === "POST") {
      const { playerId, name, pin } = await request.json().catch(() => ({}));
      if (String(pin || "").length < 4) return bad("pin_too_short");
      const now = Date.now();

      let row = playerId
        ? await env.DB.prepare("SELECT id, pin_hash FROM players WHERE id = ? AND deleted = 0").bind(playerId).first()
        : await env.DB.prepare("SELECT id, pin_hash FROM players WHERE lower(name) = lower(?) AND deleted = 0")
            .bind(String(name || "").trim()).first();
      if (row && row.pin_hash) return bad("already_claimed", 409);

      const salt = randomToken(16);
      const hash = await hashPin(pin, salt);
      if (row) {
        await env.DB.prepare("UPDATE players SET pin_hash = ?, pin_salt = ?, updated_at = ? WHERE id = ?")
          .bind(hash, salt, now, row.id).run();
      } else {
        const clean = String(name || "").trim().slice(0, 80);
        if (!clean) return bad("name_required");
        row = { id: "p_" + randomToken(9) };
        await env.DB.prepare(
          "INSERT INTO players (id, name, pin_hash, pin_salt, body, updated_at, deleted) VALUES (?,?,?,?,?,?,0)")
          .bind(row.id, clean, hash, salt, JSON.stringify({ startHi: null, createdAt: now }), now).run();
      }
      const token = randomToken(32);
      await env.DB.prepare("INSERT INTO sessions (token, player_id, created_at) VALUES (?,?,?)")
        .bind(token, row.id, now).run();
      return json({ token, playerId: row.id });
    }

    /* Same player, another device. */
    if (url.pathname === "/api/signin" && request.method === "POST") {
      const { playerId, pin } = await request.json().catch(() => ({}));
      const row = await env.DB.prepare("SELECT id, pin_hash, pin_salt FROM players WHERE id = ? AND deleted = 0")
        .bind(playerId).first();
      if (!row || !row.pin_hash) return bad("not_claimed", 404);
      if (!sameSecret(await hashPin(pin, row.pin_salt), row.pin_hash)) return bad("wrong_pin", 401);
      const token = randomToken(32);
      await env.DB.prepare("INSERT INTO sessions (token, player_id, created_at) VALUES (?,?,?)")
        .bind(token, row.id, Date.now()).run();
      return json({ token, playerId: row.id });
    }

    if (url.pathname === "/api/signout" && request.method === "POST") {
      const token = request.headers.get("x-player-token");
      if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(await readState(env, url.searchParams.get("since")));
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return bad("not_json");
      const session = await sessionOf(request, env);
      const result = await applyWrites(env, payload, session);
      const state = await readState(env, payload.since);
      return json(Object.assign(state, result, { signedInAs: session ? session.player_id : null }));
    }

    return bad("not_found", 404);
  }
};
