import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull, or, gt, sql } from "drizzle-orm";
import { apiAccessLogsTable, apiAccessTokensTable, db } from "@workspace/db";
import { sha256 } from "../lib/device-security";
import { ensureApiAccessSchema } from "../lib/ensure-schema";
import { scopeForPath } from "../lib/open-api-scopes";

export type OpenApiTokenRow = {
  id: number;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  note: string | null;
};

export type OpenApiRequest = Request & {
  openApiToken?: OpenApiTokenRow;
};

const rateBucket = new Map<string, { n: number; reset: number }>();
/** Header token: 120/min; brauzer ?token= URL: qattiqroq 60/min */
const RATE_LIMIT_HEADER = 120;
const RATE_LIMIT_QUERY = 60;
const RATE_WINDOW_MS = 60_000;

let schemaReady: Promise<void> | null = null;
function ensureSchemaOnce() {
  if (!schemaReady) {
    schemaReady = ensureApiAccessSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function clientIp(req: Request): string {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return xf || req.socket.remoteAddress || "";
}

function checkRate(key: string, limit: number): boolean {
  const now = Date.now();
  const cur = rateBucket.get(key);
  if (!cur || cur.reset < now) {
    rateBucket.set(key, { n: 1, reset: now + RATE_WINDOW_MS });
    return true;
  }
  if (cur.n >= limit) return false;
  cur.n += 1;
  return true;
}

function extractBearer(req: Request): string | null {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    return t || null;
  }
  const key = String(req.headers["x-api-key"] || "").trim();
  if (key) return key;
  // Brauzer manzil satriga qo‘yish uchun: ?token=vak_… yoki ?access_token=vak_…
  const q = req.query || {};
  const fromQ = String(
    (q as Record<string, unknown>).token ??
      (q as Record<string, unknown>).access_token ??
      "",
  ).trim();
  return fromQ || null;
}

const SECRET_QUERY_KEYS = new Set(["token", "access_token", "api_key", "apikey", "key"]);

function safeQuerySummary(query: Request["query"]): string {
  return Object.keys(query || {})
    .filter((k) => !SECRET_QUERY_KEYS.has(k.toLowerCase()))
    .slice(0, 12)
    .map((k) => `${k}=${String((query as Record<string, unknown>)[k]).slice(0, 40)}`)
    .join("&")
    .slice(0, 300);
}

async function writeLog(opts: {
  tokenId: number;
  method: string;
  path: string;
  status: number;
  ip: string;
  userAgent: string;
  deviceLabel: string;
  querySummary: string;
  durationMs: number;
}) {
  try {
    await db.insert(apiAccessLogsTable).values({
      tokenId: opts.tokenId,
      method: opts.method,
      path: opts.path,
      status: opts.status,
      ip: opts.ip || null,
      userAgent: opts.userAgent || null,
      deviceLabel: opts.deviceLabel || null,
      querySummary: opts.querySummary || null,
      durationMs: opts.durationMs,
    });
    await db
      .update(apiAccessTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiAccessTokensTable.id, opts.tokenId));
  } catch {
    /* ignore log errors */
  }
}

/**
 * Read-only open API: Bearer token majburiy, faqat GET.
 * Path: /api/open/v1/...
 */
export async function requireOpenApiToken(
  req: OpenApiRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const started = Date.now();
  const ip = clientIp(req);
  const ua = String(req.headers["user-agent"] || "").slice(0, 400);
  const deviceLabel = String(
    req.headers["x-device-label"] || req.headers["x-client-name"] || req.headers["x-api-wall"] || "",
  ).slice(0, 120);
  const relPath = req.path || "/";
  const querySummary = safeQuerySummary(req.query);

  const finishLog = (tokenId: number | null, status: number) => {
    if (!tokenId) return;
    void writeLog({
      tokenId,
      method: req.method,
      path: `/api/open/v1${relPath}`,
      status,
      ip,
      userAgent: ua,
      deviceLabel,
      querySummary,
      durationMs: Date.now() - started,
    });
  };

  try {
    await ensureSchemaOnce();
  } catch {
    res.status(503).json({ error: "API token sxemasi tayyor emas" });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.status(405).json({ error: "Faqat GET so‘rovlariga ruxsat (read-only API)" });
    return;
  }

  if (req.method === "OPTIONS") {
    next();
    return;
  }

  // openapi.json — tokensiz (hujjatlar katalogi)
  if (relPath === "/openapi.json" || relPath === "/openapi") {
    next();
    return;
  }

  const authHeader = String(req.headers.authorization || "").toLowerCase().startsWith("bearer ");
  const apiKeyHeader = Boolean(String(req.headers["x-api-key"] || "").trim());
  const fromQuery = !authHeader && !apiKeyHeader;
  const raw = extractBearer(req);
  if (!raw) {
    res.status(401).json({
      error:
        "Token kerak. Header: Authorization: Bearer <token> — yoki brauzer uchun URL ga ?token=vak_… qo‘shing",
    });
    return;
  }

  const rateCap = fromQuery ? RATE_LIMIT_QUERY : RATE_LIMIT_HEADER;
  if (!checkRate(`${ip}|${raw.slice(0, 16)}|${fromQuery ? "q" : "h"}`, rateCap)) {
    res.status(429).json({
      error: fromQuery
        ? "Juda ko‘p so‘rov (brauzer ?token=) — daqiqada 60 tadan oshmasin"
        : "Juda ko‘p so‘rov — daqiqada 120 tadan oshmasin",
    });
    return;
  }

  const hash = sha256(raw);
  const [row] = await db
    .select()
    .from(apiAccessTokensTable)
    .where(eq(apiAccessTokensTable.tokenHash, hash))
    .limit(1);

  if (!row) {
    res.status(401).json({ error: "Token noto‘g‘ri yoki topilmadi" });
    return;
  }
  if (row.revokedAt) {
    finishLog(row.id, 401);
    res.status(401).json({ error: "Token bekor qilingan" });
    return;
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    finishLog(row.id, 401);
    res.status(401).json({ error: "Token muddati tugagan" });
    return;
  }

  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
  const needed = scopeForPath(relPath);
  // /me va /health — har qanday yaroqli token
  const free = relPath === "/me" || relPath === "/health" || relPath === "/";
  if (!free && needed && !scopes.includes(needed)) {
    finishLog(row.id, 403);
    res.status(403).json({
      error: "Bu token uchun scope yo‘q",
      required: needed,
      scopes,
    });
    return;
  }

  req.openApiToken = {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes,
    expiresAt: row.expiresAt,
    note: row.note,
  };

  res.on("finish", () => {
    finishLog(row.id, res.statusCode || 200);
  });

  next();
}

/** Admin helper: faol tokenlar soni */
export async function countActiveApiTokens(): Promise<number> {
  await ensureSchemaOnce().catch(() => undefined);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiAccessTokensTable)
    .where(
      and(
        isNull(apiAccessTokensTable.revokedAt),
        or(isNull(apiAccessTokensTable.expiresAt), gt(apiAccessTokensTable.expiresAt, new Date())),
      ),
    );
  return Number(rows[0]?.n || 0);
}
