/**
 * Fairway Ledger — group sync
 *
 * A tiny Cloudflare Worker that holds one golf group's ledger in Workers KV.
 * It replaces the public jsonblob.com store with an endpoint you own: you can
 * see it, rotate it and delete it.
 *
 *   GET    /g/:id   -> the group's ledger, or {} if it does not exist yet
 *   PUT    /g/:id   -> replace the ledger (JSON body)
 *   DELETE /g/:id   -> erase the group for everyone
 *   GET    /        -> a one-line health check
 *
 * The id in the URL is the group's only credential, exactly like a shared
 * document link: anyone holding it can read and write that group. The app
 * generates a 32-character random id, and this Worker refuses anything
 * shorter than 20 so a short, guessable group can never be created.
 */

const MIN_ID = 20;
const MAX_BYTES = 2 * 1024 * 1024;          // a very large group is still ~100 KB
const ID_OK = /^[A-Za-z0-9_-]{20,64}$/;

/** ALLOWED_ORIGIN is "*" or a comma-separated list; a listed caller gets its
 *  own origin echoed back, anything else gets a value it cannot match. */
function allowOrigin(request, env) {
  const setting = ((env && env.ALLOWED_ORIGIN) || "*").trim();
  if (setting === "*") return "*";
  const asked = request.headers.get("origin") || "";
  const list = setting.split(",").map(x => x.trim()).filter(Boolean);
  return list.includes(asked) ? asked : list[0];
}

function cors(request, env, extra) {
  return Object.assign({
    "access-control-allow-origin": allowOrigin(request, env),
    "vary": "origin",
    "access-control-allow-methods": "GET,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "cache-control": "no-store"
  }, extra || {});
}

const json = (request, env, body, status) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: cors(request, env, { "content-type": "application/json; charset=utf-8" })
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });

    if (url.pathname === "/" || url.pathname === "") {
      return json(request, env, { service: "fairway-ledger-sync", ok: true });
    }

    const match = url.pathname.match(/^\/g\/([^/]+)\/?$/);
    if (!match) return json(request, env, { error: "not_found" }, 404);

    const id = decodeURIComponent(match[1]);
    if (!ID_OK.test(id)) {
      return json(request, env, { error: "bad_group_id", detail: `Group ids are ${MIN_ID}-64 characters of A-Z a-z 0-9 _ -` }, 400);
    }
    if (!env.LEDGER) return json(request, env, { error: "kv_not_bound" }, 500);

    if (request.method === "GET") {
      const body = await env.LEDGER.get(id);
      return new Response(body || "{}", {
        headers: cors(request, env, { "content-type": "application/json; charset=utf-8" })
      });
    }

    if (request.method === "PUT") {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json(request, env, { error: "too_large" }, 413);
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { return json(request, env, { error: "not_json" }, 400); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(request, env, { error: "not_an_object" }, 400);
      }
      await env.LEDGER.put(id, text);
      return json(request, env, { ok: true, bytes: text.length });
    }

    if (request.method === "DELETE") {
      await env.LEDGER.delete(id);
      return json(request, env, { ok: true, deleted: true });
    }

    return json(request, env, { error: "method_not_allowed" }, 405);
  }
};
