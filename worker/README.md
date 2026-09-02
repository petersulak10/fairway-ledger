# Fairway Ledger — your own group server

A ~90-line Cloudflare Worker that keeps one golf group's ledger in Workers KV,
so the shared scoreboard lives on an endpoint you control instead of a public
store. Free: the plan allows 100,000 reads and 1,000 writes a day, and a golf
group uses a handful.

## Already live

Deployed to **https://fairway-sync.fairway-sync.workers.dev** on Peter's
Cloudflare account, with the KV namespace `LEDGER`
(`746676e5df10412cb6e3e517bd580398`) and `ALLOWED_ORIGIN` locked to the live
site plus localhost.

To redeploy after a change: `cd worker && npx wrangler deploy`.

## Putting it live somewhere else (about five minutes)

You need a free Cloudflare account. No card required.

```bash
cd worker && npm install
npx wrangler login
```

Create the storage and copy the id it prints into `wrangler.toml` in place of
`PUT_YOUR_KV_ID_HERE`:

```bash
npx wrangler kv namespace create LEDGER
```

Then deploy:

```bash
npx wrangler deploy
```

Wrangler prints your address. Check it:

```bash
curl https://your-worker-address/
```

You should get `{"service":"fairway-ledger-sync","ok":true}`.

## Point the app at it

In the app: **Settings → Share with the group → Keep it on your own server**,
paste the address, then **Start a group**. You get a link like
`https://fairway-sync.yourname.workers.dev/g/CM8CPAvClYOMpKp3DK0fXKzEcu1pAnL4`
to send to your friends. **Erase for everyone** deletes it from your server.

Leave that field empty and the app falls back to the free public store, exactly
as before.

## Locking it down (optional)

`ALLOWED_ORIGIN` takes a comma-separated list of the sites allowed to call the
Worker; `*` allows any page. A caller on the list gets its own origin echoed
back, anything else gets one it cannot match, so the browser blocks it:

```toml
[vars]
ALLOWED_ORIGIN = "https://petersulak10.github.io,http://localhost:8791"
```

Note the Worker address is **not** baked into the app — it is pasted into
Settings on your own devices only. Friends never need it, because the group
link already contains it. That way a stranger cannot use your public site to
create groups on your Worker.

## What it does

| Route | Does |
|---|---|
| `GET /` | health check |
| `GET /g/:id` | the group's ledger, or `{}` if it doesn't exist |
| `PUT /g/:id` | replace the ledger (JSON object, max 2 MB) |
| `DELETE /g/:id` | erase the group for everyone |

The id in the link is the group's only credential, like a shared document link:
anyone holding it can read and write that group. The app generates a random
32-character id and the Worker refuses anything under 20 characters, so a short
guessable group can never exist. There are no other accounts and no passwords.

Every route was tested twice — locally with `wrangler dev --local` and again
against the deployed Worker — including the rejections (short id, illegal
characters, non-JSON body, a JSON array instead of an object, unknown path,
POST) and the origin allowlist. A full round trip was then run through the live
site: create a group, join from a clean device with only the link, add a player
and a round, confirm both on the server, then erase for everyone.
