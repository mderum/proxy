export const config = {
  api: {
    bodyParser: false,
  },
};

// Serves GET / (via vercel.json rewrite "/" -> "/api").
// Same payload as the "/" health branch in [...path].js.
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "*",
    });
    res.end();
    return;
  }
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  res.status(200).send(
    JSON.stringify({
      status: "ok",
      service: "qwen-mid-proxy",
      upstream: (process.env.UPSTREAM_BASE_URL || "https://qwen.aikit.club").replace(/\/+$/, ""),
      timestamp: new Date().toISOString(),
      usage: "Point your OpenAI-compatible client at <your-vercel-url>/v1",
    })
  );
}
