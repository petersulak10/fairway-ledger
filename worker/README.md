# Fairway Ledger — your own group server

A ~90-line Cloudflare Worker that keeps one golf group's ledger in Workers KV,
so the shared scoreboard lives on an endpoint you control instead of a public
store. Free: the plan allows 100,000 reads and 1,000 writes a day, and a golf
group uses a handful.

## Put it live (about five minutes)

You need a free Cloudflare account — I can't create one for you, so this part
is yours. No card required.

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

Wrangler prints your address, something like
`https://fairway-sync.yourname.workers.dev`. Check it:

```bash
curl https://fairway-sync.yourname.workers.dev/
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

Once it works, edit `wrangler.toml` and set `ALLOWED_ORIGIN` to your own site
so no other page can call it, then `npx wrangler deploy` again:

```toml
[vars]
ALLOWED_ORIGIN = "https://petersulak10.github.io"
```

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

Every route was tested locally with `wrangler dev --local`, including the
rejections: short id, illegal characters, non-JSON body, a JSON array instead of
an object, unknown path, and POST.
