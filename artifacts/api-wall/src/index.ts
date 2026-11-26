import express from "express";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8091);
const UPSTREAM = String(process.env.OPEN_API_UPSTREAM || "http://127.0.0.1:8080/api/open/v1").replace(/\/$/, "");
const WALL_LABEL = String(process.env.API_WALL_LABEL || "api-wall");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: WALL_LABEL, upstream: UPSTREAM, ts: new Date().toISOString() });
});

function clientIp(req: express.Request): string {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return xf || req.socket.remoteAddress || "";
}

/** /v1/* → upstream /api/open/v1/* ; /open-api/v1/* ham qabul */
function mapPath(rawPath: string): string {
  let p = rawPath || "/";
  if (p.startsWith("/open-api/")) p = p.slice("/open-api".length);
  if (p.startsWith("/v1")) p = p.slice("/v1".length) || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  return p;
}

app.use((req, res) => {
  const started = Date.now();
  const rel = mapPath(req.path);
  const target = new URL(`${UPSTREAM}${rel}`);
  if (req.url?.includes("?")) {
    const qs = req.url.slice(req.url.indexOf("?") + 1);
    target.search = qs;
  }

  const isHttps = target.protocol === "https:";
  const transport = isHttps ? https : http;
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: target.host,
    "x-forwarded-for": clientIp(req),
    "x-forwarded-proto": req.protocol,
    "x-forwarded-host": String(req.headers.host || ""),
    "x-api-wall": WALL_LABEL,
    "x-real-ip": clientIp(req),
  };
  delete headers["content-length"];

  const proxyReq = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
      timeout: 60_000,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502;
      res.status(status);
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (v == null) continue;
        if (k.toLowerCase() === "transfer-encoding") continue;
        res.setHeader(k, v);
      }
      proxyRes.pipe(res);
      proxyRes.on("end", () => {
        const ms = Date.now() - started;
        console.log(
          JSON.stringify({
            wall: WALL_LABEL,
            method: req.method,
            path: rel,
            status,
            ip: clientIp(req),
            ua: String(req.headers["user-agent"] || "").slice(0, 160),
            durationMs: ms,
          }),
        );
      });
    },
  );

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ error: "Upstream timeout" });
  });
  proxyReq.on("error", (err) => {
    console.error("[api-wall] upstream error", err.message);
    if (!res.headersSent) res.status(502).json({ error: "Upstream unavailable" });
  });

  if (req.method === "GET" || req.method === "HEAD") {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[api-wall] listening :${PORT} → ${UPSTREAM}`);
});
