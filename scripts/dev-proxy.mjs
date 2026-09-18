// Local dev mirror of api/[[...path]].js (minus Vercel specifics).
// Run: node scripts/dev-proxy.mjs [port]
// Then: curl http://localhost:3000/v1/models -H "Authorization: Bearer test"
import http from "node:http";
import { Readable } from "node:stream";

const UPSTREAM = (process.env.UPSTREAM_BASE_URL || "https://qwen.aikit.club").replace(/\/+$/, "");
const PORT = Number(process.argv[2] || 3000);

const SKIP_REQ = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);
const SKIP_RES = new Set(["connection", "content-encoding", "content-length", "transfer-encoding", "keep-alive"]);

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "*",
    });
    res.end();
    return;
  }
  if (url === "/" || url === "/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ status: "ok", upstream: UPSTREAM }));
    return;
  }
  const outHeaders = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (SKIP_REQ.has(k.toLowerCase())) continue;
    if (v !== undefined) outHeaders[k] = v;
  }
  const hasBody = !["GET", "HEAD"].includes(req.method || "GET");
  let body;
  if (hasBody) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }
  const upstreamRes = await fetch(`${UPSTREAM}${url}`, {
    method: req.method,
    headers: outHeaders,
    body,
    duplex: "half",
    redirect: "manual",
  });
  const resHeaders = { "access-control-allow-origin": "*" };
  upstreamRes.headers.forEach((v, k) => {
    if (!SKIP_RES.has(k.toLowerCase())) resHeaders[k] = v;
  });
  res.writeHead(upstreamRes.status, resHeaders);
  if (upstreamRes.body) await Readable.fromWeb(upstreamRes.body).pipe(res);
  else res.end();
});

server.listen(PORT, () => console.log(`[dev-proxy] http://localhost:${PORT} -> ${UPSTREAM}`));
