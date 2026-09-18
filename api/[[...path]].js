import { Readable } from "node:stream";

export const config = {
  api: {
    bodyParser: false,
  },
};

// Upstream proxy target. Override on Vercel via env var UPSTREAM_BASE_URL.
// No trailing slash.
const UPSTREAM =
  (process.env.UPSTREAM_BASE_URL || "https://qwen.aikit.club").replace(
    /\/+$/,
    ""
  );

// Hop-by-hop / runtime-managed headers we must NOT forward in either direction.
const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "x-vercel-forwarded-for",
  "x-vercel-id",
  "x-vercel-ip-city",
  "x-vercel-ip-country",
  "x-vercel-ip-country-region",
  "x-vercel-ip-latitude",
  "x-vercel-ip-longitude",
  "x-vercel-ip-timezone",
  "x-vercel-proxy-signature",
  "x-vercel-proxy-signature-ts",
]);

const SKIP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding", // undici fetch already decompresses; re-sending it corrupts the body
  "content-length", // Node recomputes for chunked streaming
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "trailer",
]);

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
    "access-control-max-age": "86400",
  };
}

// Strip the internal /api mount prefix (present after vercel.json rewrite)
// so the upstream path stays 1:1. Query string is preserved.
function stripApiPrefix(url) {
  if (url === "/api" || url === "/api/") return "/";
  if (url.startsWith("/api/")) return url.slice(4) || "/";
  return url || "/";
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const started = Date.now();
  const originalUrl = req.url || "/";

  // Preflight: answer locally, never hit upstream.
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const path = stripApiPrefix(originalUrl);

  // Local health check. Upstream "/" is a 302 to a website, so never proxy it.
  if (path === "/" || path === "/health") {
    res.setHeader("content-type", "application/json");
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    res.status(200).send(
      JSON.stringify({
        status: "ok",
        service: "qwen-mid-proxy",
        upstream: UPSTREAM,
        timestamp: new Date().toISOString(),
        usage: "Point your OpenAI-compatible client at <your-vercel-url>/v1",
      })
    );
    return;
  }

  const target = `${UPSTREAM}${path}`;

  // Forward headers (Authorization passthrough included).
  const outHeaders = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (SKIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (value !== undefined) outHeaders[key] = value;
  }

  const hasBody = !["GET", "HEAD"].includes((req.method || "GET").toUpperCase());
  let body;
  try {
    body = hasBody ? await readRawBody(req) : undefined;
  } catch (err) {
    console.error(`[proxy] body read failed ${req.method} ${path}:`, err?.message);
    res.writeHead(400, { "content-type": "application/json", ...corsHeaders() });
    res.end(
      JSON.stringify({
        error: { message: "Failed to read request body", type: "proxy_error", code: 400 },
      })
    );
    return;
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(target, {
      method: req.method,
      headers: outHeaders,
      body,
      duplex: "half", // required by undici when sending a body stream/buffer
      redirect: "manual",
    });
  } catch (err) {
    console.error(`[proxy] upstream fetch failed ${req.method} ${path}:`, err?.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json", ...corsHeaders() });
    }
    res.end(
      JSON.stringify({
        error: {
          message: `Upstream unreachable: ${err?.message || err}`,
          type: "proxy_error",
          code: 502,
        },
      })
    );
    return;
  }

  // Forward status + headers, inject open CORS.
  const resHeaders = { ...corsHeaders() };
  upstreamRes.headers.forEach((value, key) => {
    if (SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    resHeaders[key] = value;
  });

  res.writeHead(upstreamRes.status, resHeaders);
  try {
    res.socket?.setNoDelay?.(true);
  } catch {
    // ignore
  }

  try {
    if (upstreamRes.body) {
      // Stream byte-for-byte: works for JSON, SSE (stream:true) and binary alike.
      await Readable.fromWeb(upstreamRes.body).pipe(res);
    } else {
      res.end();
    }
    console.log(
      `[proxy] ${req.method} ${path} -> ${upstreamRes.status} (${Date.now() - started}ms)`
    );
  } catch (err) {
    // Client aborted mid-stream; nothing useful left to send.
    console.error(`[proxy] stream error ${req.method} ${path}:`, err?.message);
    try {
      res.end();
    } catch {
      // ignore
    }
  }
}
