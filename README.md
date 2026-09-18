# Qwen Mid-Proxy (Vercel)

Transparent middle proxy:

```
User  >>>  https://<your-app>.vercel.app  >>>  https://qwen.aikit.club  (and back)
```

Path, method, query string, headers (including `Authorization: Bearer ...`)
and body are forwarded 1:1. Responses — including SSE streams
(`"stream": true`) and multipart uploads (`/images/edits`,
`/videos/generations`) — stream straight back through.

Per your choices: **proxy at root** (1:1 paths), **client header passthrough**
for auth, **streaming supported**, **backend only** (no UI).

## Project layout

```
api/[...path].js     # catch-all proxy function (the whole app)
api/index.js         # root "/" health endpoint
vercel.json          # explicit rewrites from public paths to /api/*
package.json         # zero dependencies, Node >= 18 (native fetch)
scripts/dev-proxy.mjs# local dev mirror for testing without Vercel
```

`GET /` (and `/health`) is answered locally with `{ "status": "ok", ... }`
because upstream `/` is a 302 to a website — it is never proxied.

## Deploy on Vercel

Option A — dashboard (easiest):

1. Push this folder to GitHub.
2. Vercel → Add New → Project → import the repo. No build settings needed
   (framework preset: Other, build command empty).
3. Deploy. Done.

Option B — CLI:

```powershell
npm i -g vercel
vercel --prod
```

Optional env var: `UPSTREAM_BASE_URL` (default `https://qwen.aikit.club`).

## Use it (drop-in OpenAI base URL)

Base URL (note the `/v1` suffix, same as the aikit URL you used before):

```
https://<your-app>.vercel.app/v1
```

```bash
# models
curl "https://<your-app>.vercel.app/v1/models" \
  -H "Authorization: Bearer <token>"

# chat (non-streaming)
curl -X POST "https://<your-app>.vercel.app/v1/chat/completions" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.8-max","messages":[{"role":"user","content":"Hello"}],"stream":false}'

# chat (streaming SSE)
curl -N -X POST "https://<your-app>.vercel.app/v1/chat/completions" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.8-max","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

Python (OpenAI SDK):

```python
from openai import OpenAI
client = OpenAI(base_url="https://<your-app>.vercel.app/v1", api_key="<token>")
print(client.models.list())
```

## Notes

- Auth is pure passthrough: the function never reads or stores tokens.
- `OPTIONS` preflights are answered locally with `Access-Control-Allow-Origin: *`.
- Upstream errors (4xx/5xx JSON) pass through untouched, so clients see the real message.
- If upstream is unreachable you get a `502` in OpenAI error shape
  (`{ error: { message, type: "proxy_error", code: 502 } }`).
- Function timeout: `maxDuration: 60` (deep-research calls can be long;
  raise it on a Pro plan if needed).

## Local test

```powershell
node scripts/dev-proxy.mjs 3000
curl.exe http://localhost:3000/v1/models -H "Authorization: Bearer test"
```

## Troubleshooting

- `404 The page could not be found` → the request never reached the function.
  Check in Vercel: (1) redeployed after latest push, (2) project **Root Directory**
  is the folder containing `api/` and `vercel.json` (not its parent),
  (3) Functions tab lists `api/[...path]` and `api/index`.
- Sanity checks on the deployed URL (no token needed):
  `GET https://<your-app>.vercel.app/` → `{ "status": "ok", ... }`,
  `GET https://<your-app>.vercel.app/v1/models` (with `Authorization` header)
  → `{ "object": "list", ... }`.
- Upstream-shaped JSON errors (`chat_creation_failed`, `authentication_error`, …)
  mean the proxy is working and the problem is the token/model upstream.
