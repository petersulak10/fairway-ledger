/**
 * Fairway Ledger — the whole backend.
 *
 * One Worker serves the app and its data from a single address, backed by a
 * D1 database the whole group shares. Everyone who opens the site sees the
 * same players, rounds and course corrections; there are no group links and
 * no per-browser ledgers.
 *
 * A player is a global identity — one name, one PIN, one handicap, one set of
 * rounds. A group is a circle of people who see each other, and a player can
 * belong to several. What a group scopes is the audience, not the golf.
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
 * ground for everyone in the group, and so are comments.
 *
 * One player is the group's admin — the first to claim a card, after which an
 * admin can pass the role on. An admin can remove a player, clear a forgotten
 * PIN, and delete anybody's round or comment.
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
  const row = await env.DB.prepare(
    "SELECT s.token, s.player_id, s.created_at FROM sessions s WHERE s.token = ?").bind(token).first();
  if (!row) return null;
  if (Date.now() - row.created_at > TOKEN_TTL) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return row;
}

/** Which group does this request's code belong to? */
async function groupOf(request, env) {
  const code = norm(request.headers.get("x-join-code"));
  if (!code) return null;
  return await env.DB.prepare(
    "SELECT id, name, join_code FROM groups WHERE join_code = ? AND deleted = 0").bind(code).first();
}

/** The players in a group, as a list of ids. */
async function memberIds(env, groupId) {
  const rows = await env.DB.prepare(
    "SELECT player_id FROM memberships WHERE group_id = ? AND deleted = 0").bind(groupId).all();
  return (rows.results || []).map(r => r.player_id);
}

async function isGroupAdmin(env, groupId, playerId) {
  if (!playerId) return false;
  const row = await env.DB.prepare(
    "SELECT is_admin FROM memberships WHERE group_id = ? AND player_id = ? AND deleted = 0")
    .bind(groupId, playerId).first();
  return !!(row && row.is_admin);
}

/* ---------- reading ---------- */
async function readState(env, since, group) {
  const s = Number(since) || 0;
  const ids = await memberIds(env, group.id);
  /* A group with nobody in it still needs a valid IN () list. */
  const inList = ids.length ? ids.map(() => "?").join(",") : "''";
  const args = ids.length ? ids : [];
  const memberFilter = " AND player_id IN (" + inList + ")";
  const idFilter = " AND id IN (" + inList + ")";
  const [players, rounds, courses, comments, photos] = await Promise.all([
    env.DB.prepare("SELECT p.id, p.name, p.body, p.updated_at, p.deleted, " +
      "(SELECT is_admin FROM memberships m WHERE m.group_id = ? AND m.player_id = p.id AND m.deleted = 0) AS is_admin, " +
      "(p.pin_hash IS NOT NULL) AS claimed FROM players p WHERE p.updated_at > ?" + idFilter)
      .bind(group.id, s, ...args).all(),
    env.DB.prepare("SELECT id, player_id, body, updated_at, deleted FROM rounds WHERE updated_at > ?" + memberFilter).bind(s, ...args).all(),
    env.DB.prepare("SELECT id, body, updated_at, deleted FROM courses WHERE updated_at > ?").bind(s).all(),
    env.DB.prepare("SELECT id, round_id, player_id, body, updated_at, deleted FROM comments WHERE updated_at > ?").bind(s).all(),
    env.DB.prepare("SELECT id, round_id, player_id, caption, updated_at, deleted FROM photos WHERE updated_at > ?").bind(s).all()
  ]);
  const unpack = (row, extra) => {
    let body = {};
    try { body = JSON.parse(row.body) || {}; } catch (e) { /* a bad row must not break a sync */ }
    return Object.assign(body, { id: row.id, updatedAt: row.updated_at }, row.deleted ? { deleted: true } : {}, extra || {});
  };
  return {
    now: Date.now(),
    group: { id: group.id, name: group.name, code: group.join_code, members: ids.length },
    players: (players.results || []).map(r => unpack(r, { name: r.name, claimed: !!r.claimed, admin: !!r.is_admin })),
    rounds: (rounds.results || []).map(r => unpack(r, { playerId: r.player_id })),
    courses: (courses.results || []).map(r => unpack(r)),
    comments: (comments.results || []).map(r => ({
      id: r.id, roundId: r.round_id, playerId: r.player_id, body: r.body,
      updatedAt: r.updated_at, deleted: !!r.deleted
    })),
    photos: (photos.results || []).map(r => ({
      id: r.id, roundId: r.round_id, playerId: r.player_id, caption: r.caption,
      updatedAt: r.updated_at, deleted: !!r.deleted
    }))
  };
}

/* ---------- writing ---------- */
function bodyOf(rec, drop) {
  const body = Object.assign({}, rec);
  ["id", "updatedAt", "deleted", "claimed", "admin"].concat(drop || []).forEach(k => delete body[k]);
  return JSON.stringify(body);
}

async function applyWrites(env, payload, session, group) {
  const now = Date.now();
  const stmts = [];
  const refused = [];
  const take = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_RECORDS);
  const mine = session ? session.player_id : null;
  const isAdmin = session ? await isGroupAdmin(env, group.id, session.player_id) : false;

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
  /* A claimed card may only be written by the device holding its PIN —
     unless you are the group's admin. */
  const mayWrite = (playerId) => isAdmin || !claimed.has(playerId) || playerId === mine;

  for (const p of take(payload.players)) {
    if (!p || !p.id) continue;
    if (!mayWrite(p.id)) { refused.push(p.id); continue; }
    stmts.push(env.DB.prepare(
      "INSERT INTO players (id, name, body, updated_at, deleted) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, body = excluded.body, " +
      "updated_at = excluded.updated_at, deleted = excluded.deleted " +
      "WHERE excluded.updated_at >= players.updated_at")
      .bind(p.id, String(p.name || "").slice(0, 80), bodyOf(p, ["name"]), now, p.deleted ? 1 : 0));

    /* Adding someone to your scorecard puts them in this group — otherwise
       you would be the only person who could ever see them. */
    if (!p.deleted && group)
      stmts.push(env.DB.prepare(
        "INSERT INTO memberships (id, group_id, player_id, is_admin, updated_at, deleted) VALUES (?,?,?,0,?,0) " +
        "ON CONFLICT(id) DO UPDATE SET deleted = 0, updated_at = excluded.updated_at " +
        "WHERE memberships.deleted = 1")
        .bind(group.id + "|" + p.id, group.id, p.id, now));
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
  for (const cm of take(payload.comments)) {
    if (!cm || !cm.id || !cm.roundId) continue;
    const author = cm.playerId;
    /* you write your own comments; an admin may remove any */
    const allowed = (author && author === mine) || (isAdmin && cm.deleted);
    if (!allowed) { refused.push(cm.id); continue; }
    stmts.push(env.DB.prepare(
      "INSERT INTO comments (id, round_id, player_id, body, updated_at, deleted) VALUES (?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, " +
      "deleted = excluded.deleted WHERE comments.player_id = excluded.player_id OR excluded.deleted = 1")
      .bind(cm.id, cm.roundId, author || mine, String(cm.body || "").slice(0, 1000), now, cm.deleted ? 1 : 0));
  }

  for (const ph of take(payload.photos)) {
    if (!ph || !ph.id) continue;
    const allowed = (ph.playerId && ph.playerId === mine) || (isAdmin && ph.deleted);
    if (!allowed) { refused.push(ph.id); continue; }
    if (ph.deleted && env.PHOTOS) { try { await env.PHOTOS.delete("p/" + ph.id); } catch (e) { /* index still goes */ } }
    stmts.push(env.DB.prepare(
      "UPDATE photos SET caption = ?, updated_at = ?, deleted = ? WHERE id = ? AND (player_id = ? OR ? = 1)")
      .bind(String(ph.caption || "").slice(0, 200), now, ph.deleted ? 1 : 0, ph.id, mine, isAdmin ? 1 : 0));
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
    /* A picture is fetched by an <img> tag, so it carries no headers of its
       own; the unguessable id in the path is what protects it. */
    const photo = url.pathname.match(/^\/photo\/([A-Za-z0-9_-]{16,64})$/);
    if (photo) {
      if (!env.PHOTOS) return new Response("not configured", { status: 500 });
      const obj = await env.PHOTOS.getWithMetadata("p/" + photo[1], { type: "arrayBuffer" });
      if (!obj || !obj.value) return new Response("not found", { status: 404 });
      return new Response(obj.value, {
        headers: {
          "content-type": (obj.metadata && obj.metadata.type) || "image/jpeg",
          "cache-control": "public, max-age=31536000, immutable"
        }
      });
    }

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    if (!env.DB) return bad("database_not_bound", 500);

    /* Check a join code without being in the group yet. */
    /* Whoever runs the group can rename it or change the code it is joined by. */
    if (url.pathname === "/api/group/rename" && request.method === "POST") {
      const group = await groupOf(request, env);
      if (!group) return bad("no_group_code", 404);
      const session = await sessionOf(request, env);
      if (!session) return bad("signed_out", 401);
      if (!(await isGroupAdmin(env, group.id, session.player_id))) return bad("not_admin", 403);

      const { name, code } = await request.json().catch(() => ({}));
      const clean = String(name || "").trim().slice(0, 60);
      if (!clean) return bad("no_name");
      let key = group.join_code;
      if (code) {
        key = norm(code).replace(/[^a-z0-9]/g, "").slice(0, 24);
        if (key.length < 4) return bad("code_too_short");
        if (key !== group.join_code) {
          const clash = await env.DB.prepare(
            "SELECT id FROM groups WHERE join_code = ? AND deleted = 0").bind(key).first();
          if (clash) return bad("code_taken", 409);
        }
      }
      await env.DB.prepare("UPDATE groups SET name = ?, join_code = ?, updated_at = ? WHERE id = ?")
        .bind(clean, key, Date.now(), group.id).run();
      return json({ ok: true, id: group.id, name: clean, code: key });
    }

    /* Creating a group is the one thing you can do from nothing: a brand-new
       player needs a way to make their first group, and there is no group to
       be a member of yet. Bring a token if you have one, or a name and PIN. */
    if (url.pathname === "/api/group/create" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { name, code, playerName, pin } = body;
      let session = await sessionOf(request, env);

      if (!session) {
        const clean = String(playerName || "").trim().slice(0, 80);
        if (!clean) return bad("signed_out", 401);
        if (String(pin || "").length < 4) return bad("pin_too_short");
        const taken = await env.DB.prepare(
          "SELECT id, pin_hash FROM players WHERE lower(name) = lower(?) AND deleted = 0").bind(clean).first();
        if (taken && taken.pin_hash) return bad("name_taken", 409);
        const now0 = Date.now();
        const salt = randomToken(16);
        const hash = await hashPin(pin, salt);
        const pid = taken ? taken.id : "p_" + randomToken(9);
        if (taken) {
          await env.DB.prepare("UPDATE players SET pin_hash = ?, pin_salt = ?, updated_at = ? WHERE id = ?")
            .bind(hash, salt, now0, pid).run();
        } else {
          await env.DB.prepare(
            "INSERT INTO players (id, name, pin_hash, pin_salt, body, updated_at, deleted) VALUES (?,?,?,?,?,?,0)")
            .bind(pid, clean, hash, salt, JSON.stringify({ startHi: null, createdAt: now0 }), now0).run();
        }
        const tok = randomToken(32);
        await env.DB.prepare("INSERT INTO sessions (token, player_id, created_at) VALUES (?,?,?)")
          .bind(tok, pid, now0).run();
        session = { player_id: pid, __token: tok };
      }
      const clean = String(name || "").trim().slice(0, 60);
      const key = norm(code);
      if (!clean) return bad("name_required");
      if (key.length < 4) return bad("code_too_short");
      const taken = await env.DB.prepare("SELECT id FROM groups WHERE join_code = ? AND deleted = 0").bind(key).first();
      if (taken) return bad("code_taken", 409);
      const now = Date.now();
      const gid = "g_" + randomToken(9);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO groups (id, name, join_code, updated_at, deleted) VALUES (?,?,?,?,0)")
          .bind(gid, clean, key, now),
        env.DB.prepare("INSERT INTO memberships (id, group_id, player_id, is_admin, updated_at, deleted) VALUES (?,?,?,1,?,0)")
          .bind(gid + "|" + session.player_id, gid, session.player_id, now)
      ]);
      return json({ id: gid, name: clean, code: key, playerId: session.player_id,
                    token: session.__token || undefined });
    }

    const group = await groupOf(request, env);

    if (url.pathname === "/api/hello") {
      return json({ ok: true, group: !!group, name: group ? group.name : null, id: group ? group.id : null });
    }
    if (!group) return bad("bad_join_code", 401);

    /* Which groups does this player belong to? */
    if (url.pathname === "/api/groups" && request.method === "GET") {
      const session = await sessionOf(request, env);
      if (!session) return json({ groups: [] });
      const rows = await env.DB.prepare(
        "SELECT g.id, g.name, g.join_code, m.is_admin FROM memberships m " +
        "JOIN groups g ON g.id = m.group_id " +
        "WHERE m.player_id = ? AND m.deleted = 0 AND g.deleted = 0 ORDER BY g.name")
        .bind(session.player_id).all();
      return json({ groups: (rows.results || []).map(r => ({
        id: r.id, name: r.name, code: r.join_code, admin: !!r.is_admin })) });
    }

    /* Joining is simply becoming a member of the group this code names. */
    if (url.pathname === "/api/group/join" && request.method === "POST") {
      const session = await sessionOf(request, env);
      if (!session) return bad("signed_out", 401);
      const now = Date.now();
      const anyAdmin = await env.DB.prepare(
        "SELECT 1 AS x FROM memberships WHERE group_id = ? AND is_admin = 1 AND deleted = 0 LIMIT 1")
        .bind(group.id).first();
      await env.DB.prepare(
        "INSERT INTO memberships (id, group_id, player_id, is_admin, updated_at, deleted) VALUES (?,?,?,?,?,0) " +
        "ON CONFLICT(id) DO UPDATE SET deleted = 0, updated_at = excluded.updated_at")
        .bind(group.id + "|" + session.player_id, group.id, session.player_id, anyAdmin ? 0 : 1, now).run();
      return json({ ok: true, id: group.id, name: group.name, admin: !anyAdmin });
    }

    if (url.pathname === "/api/group/leave" && request.method === "POST") {
      const session = await sessionOf(request, env);
      if (!session) return bad("signed_out", 401);
      await env.DB.prepare(
        "UPDATE memberships SET deleted = 1, updated_at = ? WHERE group_id = ? AND player_id = ?")
        .bind(Date.now(), group.id, session.player_id).run();
      return json({ ok: true });
    }

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
      /* Whoever arrives first in a group runs it, and can pass it on later. */
      const anyAdmin = await env.DB.prepare(
        "SELECT 1 AS x FROM memberships WHERE group_id = ? AND is_admin = 1 AND deleted = 0 LIMIT 1")
        .bind(group.id).first();
      const token = randomToken(32);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO sessions (token, player_id, created_at) VALUES (?,?,?)")
          .bind(token, row.id, now),
        env.DB.prepare(
          "INSERT INTO memberships (id, group_id, player_id, is_admin, updated_at, deleted) VALUES (?,?,?,?,?,0) " +
          "ON CONFLICT(id) DO UPDATE SET deleted = 0, updated_at = excluded.updated_at")
          .bind(group.id + "|" + row.id, group.id, row.id, anyAdmin ? 0 : 1, now)
      ]);
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

    /* ---- pictures ----
       Uploading needs the group and a signed-in player. Serving does not:
       an <img> tag cannot send headers, so the photo's own id is its key —
       32 random characters, exactly like the group link. */
    if (url.pathname === "/api/photo" && request.method === "POST") {
      if (!env.PHOTOS) return bad("photos_not_configured", 500);
      const session = await sessionOf(request, env);
      if (!session) return bad("signed_out", 401);
      const roundId = url.searchParams.get("roundId");
      if (!roundId) return bad("round_required");
      const type = request.headers.get("content-type") || "image/jpeg";
      if (!/^image\//.test(type)) return bad("not_an_image");
      const body = await request.arrayBuffer();
      if (!body.byteLength) return bad("empty");
      if (body.byteLength > 6 * 1024 * 1024) return bad("too_large", 413);

      const id = randomToken(24);
      await env.PHOTOS.put("p/" + id, body, { metadata: { type } });
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO photos (id, round_id, player_id, caption, updated_at, deleted) VALUES (?,?,?,?,?,0)")
        .bind(id, roundId, session.player_id, "", now).run();
      return json({ id, roundId, playerId: session.player_id, updatedAt: now });
    }

    /* ---- what only an admin may do ---- */
    if (url.pathname.startsWith("/api/admin/")) {
      const session = await sessionOf(request, env);
      if (!session) return bad("signed_out", 401);
      if (!(await isGroupAdmin(env, group.id, session.player_id))) return bad("not_admin", 403);
      const { playerId } = await request.json().catch(() => ({}));
      const now = Date.now();

      /* Remove a player, and their rounds and comments with them. */
      if (url.pathname === "/api/admin/remove-player") {
        if (!playerId) return bad("player_required");
        if (playerId === session.player_id) return bad("cannot_remove_yourself", 409);
        /* They leave this group; their identity and rounds are their own and
           survive, because they may well be in somebody else's group too. */
        await env.DB.prepare(
          "UPDATE memberships SET deleted = 1, updated_at = ? WHERE group_id = ? AND player_id = ?")
          .bind(now, group.id, playerId).run();
        return json({ ok: true });
      }

      /* Let somebody re-claim a card whose PIN was forgotten. */
      if (url.pathname === "/api/admin/clear-pin") {
        if (!playerId) return bad("player_required");
        await env.DB.batch([
          env.DB.prepare("UPDATE players SET pin_hash = NULL, pin_salt = NULL, updated_at = ? WHERE id = ?")
            .bind(now, playerId),
          env.DB.prepare("DELETE FROM sessions WHERE player_id = ?").bind(playerId)
        ]);
        return json({ ok: true });
      }

      /* Hand the group over, or share it. */
      if (url.pathname === "/api/admin/set-admin") {
        const { makeAdmin } = await request.clone().json().catch(() => ({}));
        if (!playerId) return bad("player_required");
        if (playerId === session.player_id && makeAdmin === false) {
          const others = await env.DB.prepare(
            "SELECT 1 AS x FROM memberships WHERE group_id = ? AND is_admin = 1 AND deleted = 0 AND player_id != ? LIMIT 1")
            .bind(group.id, session.player_id).first();
          if (!others) return bad("group_needs_an_admin", 409);
        }
        await env.DB.prepare(
          "UPDATE memberships SET is_admin = ?, updated_at = ? WHERE group_id = ? AND player_id = ?")
          .bind(makeAdmin === false ? 0 : 1, now, group.id, playerId).run();
        return json({ ok: true });
      }
      return bad("not_found", 404);
    }

    if (url.pathname === "/api/signout" && request.method === "POST") {
      const token = request.headers.get("x-player-token");
      if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(await readState(env, url.searchParams.get("since"), group));
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object") return bad("not_json");
      const session = await sessionOf(request, env);
      const result = await applyWrites(env, payload, session, group);
      const state = await readState(env, payload.since, group);
      return json(Object.assign(state, result, { signedInAs: session ? session.player_id : null }));
    }

    return bad("not_found", 404);
  }
};
