/**
 * VaksinaMed GPS/Logistika — HR backend SSO bridge.
 * API key faqat server env da; brauzerga chiqarilmaydi.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canViewLogistika } from "../lib/roles";

const router: IRouter = Router();

const ALLOWED_PATHS = new Set(["/", "/fuel", "/live", "/attendance", "/admin", "/profile"]);

function baseUrl(): string {
  return String(process.env.VAKSINAMED_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

function apiKey(): string {
  return String(process.env.VAKSINAMED_API_KEY || "").trim();
}

function isConfigured(): boolean {
  return Boolean(baseUrl() && apiKey());
}

function requireLogistika(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  if (!canViewLogistika(req.userRole)) {
    res.status(403).json({ error: "Sizda Logistika ruxsati yo‘q", code: "LOGISTIKA_FORBIDDEN" });
    return false;
  }
  return true;
}

function parseUserMap(): Record<string, string> {
  try {
    const raw = String(process.env.VAKSINAMED_USER_MAP || "").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function resolveVmUsername(opts: {
  login: string | null;
  phone: string | null;
  fullName: string | null;
  role: string | null;
}): string | null {
  const map = parseUserMap();
  const keys = [opts.login, opts.phone, opts.fullName, opts.role]
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  for (const k of keys) {
    if (map[k]) return String(map[k]).trim();
    const lower = k.toLowerCase();
    for (const [mk, mv] of Object.entries(map)) {
      if (mk.toLowerCase() === lower) return String(mv).trim();
    }
  }
  const fallback = String(process.env.VAKSINAMED_DEFAULT_USERNAME || "").trim();
  if (fallback) return fallback;
  if (opts.login) return opts.login;
  return null;
}

function normalizePath(raw: unknown): string {
  const p = String(raw || "/").trim() || "/";
  if (!p.startsWith("/")) return "/";
  const clean = p.split("?")[0]!.split("#")[0]!;
  return ALLOWED_PATHS.has(clean) ? clean : "/";
}

async function vmFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = baseUrl();
  const key = apiKey();
  if (!base || !key) {
    throw Object.assign(new Error("VaksinaMed sozlanmagan"), { status: 503 });
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  headers.set("X-API-Key", key);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

/** GET /integrations/vaksinamed/status — kalitni ochirmasdan holat */
router.get("/integrations/vaksinamed/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireLogistika(req, res)) return;
  let healthOk: boolean | null = null;
  let version: number | null = null;
  if (isConfigured()) {
    try {
      const r = await vmFetch("/api/hr/health");
      healthOk = r.ok;
      if (r.ok) {
        const body = (await r.json().catch(() => null)) as { version?: number } | null;
        version = typeof body?.version === "number" ? body.version : null;
      }
    } catch {
      healthOk = false;
    }
  }
  let host: string | null = null;
  try {
    host = baseUrl() ? new URL(baseUrl()).host : null;
  } catch {
    host = null;
  }
  res.json({
    ok: true,
    configured: isConfigured(),
    allowed: true,
    host,
    healthOk,
    version,
  });
});

/** GET /integrations/vaksinamed/menu — VaksinaMed menyu (yoki static fallback) */
router.get("/integrations/vaksinamed/menu", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireLogistika(req, res)) return;
  if (!isConfigured()) {
    res.status(503).json({
      error: "Logistika vaqtincha ulanmagan — admin VAKSINAMED_BASE_URL / API_KEY ni sozlasin",
      code: "VAKSINAMED_NOT_CONFIGURED",
    });
    return;
  }
  try {
    const r = await vmFetch("/api/hr/logistics/menu");
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(r.status === 401 ? 503 : r.status).json({
        error:
          r.status === 401
            ? "Logistika API kaliti noto‘g‘ri — admin"
            : (body as { error?: string }).error || "Menyu yuklanmadi",
        code: "VAKSINAMED_MENU_FAIL",
      });
      return;
    }
    res.json(body);
  } catch {
    res.status(503).json({ error: "Logistika ulanmadi", code: "VAKSINAMED_UNREACHABLE" });
  }
});

/** POST /integrations/vaksinamed/sso — asosiy SSO bridge */
router.post("/integrations/vaksinamed/sso", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireLogistika(req, res)) return;
  if (!isConfigured()) {
    res.status(503).json({
      error: "Logistika vaqtincha ulanmagan — admin",
      code: "VAKSINAMED_NOT_CONFIGURED",
    });
    return;
  }

  const path = normalizePath(req.body?.path);
  const embed = req.body?.embed !== false;

  try {
    const [u] = await db
      .select({
        login: usersTable.login,
        phone: usersTable.phone,
        fullName: usersTable.fullName,
        role: usersTable.role,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);

    const username = resolveVmUsername({
      login: u?.login ?? null,
      phone: u?.phone ?? null,
      fullName: u?.fullName ?? null,
      role: u?.role ?? req.userRole ?? null,
    });
    if (!username) {
      res.status(400).json({
        error: "VaksinaMed login map topilmadi (VAKSINAMED_USER_MAP yoki DEFAULT_USERNAME)",
        code: "VAKSINAMED_USER_UNMAPPED",
      });
      return;
    }

    const r = await vmFetch("/api/hr/logistics/sso", {
      method: "POST",
      body: JSON.stringify({
        username,
        hrUser: u?.login || String(req.userId),
        path,
        embed,
      }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      const msg =
        r.status === 401
          ? "Logistika API kaliti noto‘g‘ri — admin"
          : r.status === 403
            ? "Bu login VaksinaMed da ruxsat etilmagan"
            : r.status === 404
              ? "VaksinaMed da SSO hali yo‘q (m139 deploy kutilmoqda). Hozir live m138."
              : r.status === 503
                ? "Logistika SSO o‘chirilgan yoki VM_HR_API_KEY yoqilmagan"
                : String(body.error || body.message || "SSO ochilmadi");
      res.status(r.status === 401 ? 503 : r.status >= 400 && r.status < 600 ? r.status : 502).json({
        error: msg,
        code: r.status === 404 ? "VAKSINAMED_SSO_NOT_DEPLOYED" : "VAKSINAMED_SSO_FAIL",
      });
      return;
    }

    const enterUrl = typeof body.enterUrl === "string" ? body.enterUrl : null;
    if (!enterUrl) {
      res.status(502).json({ error: "enterUrl kelmadi", code: "VAKSINAMED_NO_ENTER_URL" });
      return;
    }

    res.json({
      ok: true,
      enterUrl,
      path: typeof body.path === "string" ? body.path : path,
      embed: Boolean(body.embed ?? embed),
      expiresInSec: typeof body.expiresInSec === "number" ? body.expiresInSec : 90,
      // ticket ni clientga bermaymiz — faqat enterUrl
    });
  } catch {
    res.status(503).json({ error: "Logistika ulanmadi", code: "VAKSINAMED_UNREACHABLE" });
  }
});

/** GET /integrations/vaksinamed/fleet?date= — ixtiyoriy dashboard */
router.get("/integrations/vaksinamed/fleet", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireLogistika(req, res)) return;
  if (!isConfigured()) {
    res.status(503).json({ error: "Logistika sozlanmagan", code: "VAKSINAMED_NOT_CONFIGURED" });
    return;
  }
  const date = String((req.query as { date?: string }).date || "").trim();
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  try {
    const r = await vmFetch(`/api/hr/fleet${qs}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(r.status >= 400 && r.status < 600 ? r.status : 502).json({
        error: (body as { error?: string }).error || "Fleet yuklanmadi",
      });
      return;
    }
    res.json(body);
  } catch {
    res.status(503).json({ error: "Logistika ulanmadi" });
  }
});

export default router;
