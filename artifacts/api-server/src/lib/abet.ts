import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { hasFullPlatformAccess, isHrRole } from "./roles";
import { tashkentNow } from "./davomat-shift-report";
import { notifyUser } from "./notify";
import { publicAppUrl } from "./telegram";
import { logger } from "./logger";

/** Dorixona tarmog‘i va o‘quvchilar — abet faqat ofis (ofis, distribyutsiya, ombor, oshxona …) uchun */
const NON_OFFICE_ROLES = ["mudir", "farmasevt", "stajyor", "koordinator", "oquvchi"];

export const RATE_OPEN_HM = "12:30";
export const RATE_CLOSE_HM = "15:00";

export const DISH_CATEGORIES = ["birinchi", "ikkinchi", "salat", "garnir", "non", "ichimlik", "shirinlik", "boshqa"] as const;
export type DishCategory = (typeof DISH_CATEGORIES)[number];

export const CRITERIA = ["taste", "portion", "temperature", "cleanliness", "service"] as const;
export type Criterion = (typeof CRITERIA)[number];

export const TAGS = [
  "Mazali",
  "Issiq edi",
  "Porsiya yetarli",
  "Toza va ozoda",
  "Xizmat yaxshi",
  "Sovuq edi",
  "Porsiya kam",
  "Tuzi ko‘p",
  "Tuzi kam",
  "Yog‘li",
  "Pishmagan",
  "Kech tarqatildi",
] as const;

export type MenuItem = { name: string; category: DishCategory };

export type AbetMenu = {
  day: string;
  items: MenuItem[];
  note: string | null;
  status: "draft" | "approved";
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  updatedAt: string;
};

export type AbetRating = {
  id: number;
  day: string;
  userId: number;
  overall: number;
  criteria: Partial<Record<Criterion, number>>;
  dishes: Record<string, number>;
  tags: string[];
  comment: string | null;
  source: "qr" | "app";
  createdAt: string;
  updatedAt: string;
};

export function isOfficeRole(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return !!r && !NON_OFFICE_ROLES.includes(r);
}

export function canManageAbetMenu(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return r === "oshpaz" || r === "oshpaz_rahbar" || hasFullPlatformAccess(r);
}

/** Admin, HR va Bosh oshpaz — tahlil, baholar jadvali va QR boshqaruvi */
export function canViewAbetAnalytics(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return hasFullPlatformAccess(r) || isHrRole(r) || r === "oshpaz_rahbar";
}

let ready: Promise<void> | null = null;

export function ensureAbetSchema(): Promise<void> {
  ready ??= pool
    .query(`
      CREATE TABLE IF NOT EXISTS abet_menus (
        day TEXT PRIMARY KEY,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_by INTEGER,
        approved_by INTEGER,
        approved_at TIMESTAMPTZ,
        notified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS abet_ratings (
        id SERIAL PRIMARY KEY,
        day TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        overall SMALLINT NOT NULL,
        criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
        dishes JSONB NOT NULL DEFAULT '{}'::jsonb,
        tags TEXT[] NOT NULL DEFAULT '{}',
        comment TEXT,
        source TEXT NOT NULL DEFAULT 'app',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (day, user_id)
      );
      CREATE INDEX IF NOT EXISTS abet_ratings_day_idx ON abet_ratings (day);
      CREATE TABLE IF NOT EXISTS abet_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

export type RateWindow = {
  day: string;
  now: string;
  opensAt: string;
  closesAt: string;
  state: "before" | "open" | "closed";
};

export function rateWindow(d = new Date()): RateWindow {
  const t = tashkentNow(d);
  const state = t.hm < RATE_OPEN_HM ? "before" : t.hm < RATE_CLOSE_HM ? "open" : "closed";
  return { day: t.ymd, now: t.hm, opensAt: RATE_OPEN_HM, closesAt: RATE_CLOSE_HM, state };
}

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

type MenuRow = {
  day: string;
  items: MenuItem[];
  note: string | null;
  status: string;
  created_by_name: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  updated_at: Date;
};

const MENU_SELECT = `
  SELECT m.day, m.items, m.note, m.status, m.approved_at, m.updated_at,
         cu.full_name AS created_by_name, au.full_name AS approved_by_name
  FROM abet_menus m
  LEFT JOIN users cu ON cu.id = m.created_by
  LEFT JOIN users au ON au.id = m.approved_by`;

function toMenu(r: MenuRow): AbetMenu {
  return {
    day: r.day,
    items: Array.isArray(r.items) ? r.items : [],
    note: r.note,
    status: r.status === "approved" ? "approved" : "draft",
    createdByName: r.created_by_name,
    approvedByName: r.approved_by_name,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function menuFor(day: string): Promise<AbetMenu | null> {
  await ensureAbetSchema();
  const { rows } = await pool.query<MenuRow>(`${MENU_SELECT} WHERE m.day = $1`, [day]);
  return rows[0] ? toMenu(rows[0]) : null;
}

export async function menusBetween(from: string, to: string): Promise<AbetMenu[]> {
  await ensureAbetSchema();
  const { rows } = await pool.query<MenuRow>(`${MENU_SELECT} WHERE m.day BETWEEN $1 AND $2 ORDER BY m.day DESC`, [from, to]);
  return rows.map(toMenu);
}

export function cleanMenuItems(raw: unknown): MenuItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MenuItem[] = [];
  for (const it of raw) {
    const name = String((it as { name?: unknown })?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const cat = String((it as { category?: unknown })?.category ?? "");
    out.push({ name, category: (DISH_CATEGORIES as readonly string[]).includes(cat) ? (cat as DishCategory) : "boshqa" });
    if (out.length >= 20) break;
  }
  return out;
}

/** Tahrirlansa — qayta tasdiqlash kerak (tasdiqlangan menyu o‘zgarsa xodimlarga yangilanish boradi) */
export async function saveMenu(day: string, items: MenuItem[], note: string | null, userId: number): Promise<AbetMenu> {
  await ensureAbetSchema();
  await pool.query(
    `INSERT INTO abet_menus (day, items, note, status, created_by, updated_at)
     VALUES ($1, $2::jsonb, $3, 'draft', $4, now())
     ON CONFLICT (day) DO UPDATE SET
       items = EXCLUDED.items,
       note = EXCLUDED.note,
       status = CASE WHEN abet_menus.items = EXCLUDED.items AND COALESCE(abet_menus.note, '') = COALESCE(EXCLUDED.note, '')
                     THEN abet_menus.status ELSE 'draft' END,
       updated_at = now()`,
    [day, JSON.stringify(items), note, userId],
  );
  return (await menuFor(day))!;
}

const CATEGORY_LABEL: Record<DishCategory, string> = {
  birinchi: "1-taom",
  ikkinchi: "2-taom",
  salat: "Salat",
  garnir: "Garnir",
  non: "Non",
  ichimlik: "Ichimlik",
  shirinlik: "Shirinlik",
  boshqa: "Boshqa",
};

export function menuMessage(menu: AbetMenu, update: boolean): string {
  const lines = menu.items.map((it) => `• ${it.name}${it.category !== "boshqa" ? ` (${CATEGORY_LABEL[it.category]})` : ""}`);
  return [
    update ? "🍽 Abet menyusi yangilandi. Bugun abetda quyidagilar:" : "🍽 Bugun abetda quyidagilar:",
    "",
    ...lines,
    ...(menu.note ? ["", `📝 ${menu.note}`] : []),
    "",
    `⭐ Abetni ${RATE_OPEN_HM}–${RATE_CLOSE_HM} oralig‘ida baholang: oshxonadagi QR kodni skaner qiling yoki platformada «Abet» bo‘limini oching.`,
  ].join("\n");
}

export async function officeUserIds(): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE status = 'active' AND NOT (lower(role) = ANY($1::text[]))`,
    [NON_OFFICE_ROLES],
  );
  return rows.map((r) => r.id);
}

/** Tasdiqlash: menyu bugungi bo‘lsa — darhol barcha ofis xodimlariga yuboriladi; kelajak kun bo‘lsa — o‘sha kuni ertalab job yuboradi */
export async function approveMenu(day: string, userId: number): Promise<{ menu: AbetMenu; notified: number | null }> {
  await ensureAbetSchema();
  const { rows } = await pool.query<{ notified_at: Date | null }>(
    `UPDATE abet_menus SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
     WHERE day = $1 AND jsonb_array_length(items) > 0
     RETURNING notified_at`,
    [day, userId],
  );
  if (!rows.length) throw new Error("Menyu bo‘sh — avval taomlarni kiriting");
  const menu = (await menuFor(day))!;
  const notified = day === rateWindow().day ? await broadcastMenu(menu, rows[0]!.notified_at != null) : null;
  return { menu, notified };
}

export async function broadcastMenu(menu: AbetMenu, update: boolean): Promise<number> {
  const ids = await officeUserIds();
  await pool.query(`UPDATE abet_menus SET notified_at = now() WHERE day = $1`, [menu.day]);
  const text = menuMessage(menu, update);
  const linkUrl = "/abet";
  void (async () => {
    for (const id of ids) {
      try {
        await notifyUser({ userId: id, text, type: "abet_menu", linkUrl, title: "Bugungi abet" });
      } catch (err) {
        logger.warn({ err, userId: id }, "Abet menyusi yuborilmadi");
      }
    }
  })();
  return ids.length;
}

/** Ertalab tasdiqlangan, lekin hali yuborilmagan bugungi menyu */
export async function sendPendingTodayMenu(): Promise<void> {
  await ensureAbetSchema();
  const day = rateWindow().day;
  const { rows } = await pool.query<{ day: string }>(
    `SELECT day FROM abet_menus WHERE day = $1 AND status = 'approved' AND notified_at IS NULL`,
    [day],
  );
  if (!rows.length) return;
  const menu = await menuFor(day);
  if (menu) await broadcastMenu(menu, false);
}

type RatingRow = {
  id: number;
  day: string;
  user_id: number;
  overall: number;
  criteria: Record<string, number>;
  dishes: Record<string, number>;
  tags: string[];
  comment: string | null;
  source: string;
  created_at: Date;
  updated_at: Date;
};

function toRating(r: RatingRow): AbetRating {
  return {
    id: r.id,
    day: r.day,
    userId: r.user_id,
    overall: Number(r.overall),
    criteria: r.criteria ?? {},
    dishes: r.dishes ?? {},
    tags: r.tags ?? [],
    comment: r.comment,
    source: r.source === "qr" ? "qr" : "app",
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function myRating(day: string, userId: number): Promise<AbetRating | null> {
  await ensureAbetSchema();
  const { rows } = await pool.query<RatingRow>(`SELECT * FROM abet_ratings WHERE day = $1 AND user_id = $2`, [day, userId]);
  return rows[0] ? toRating(rows[0]) : null;
}

const score = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
};

export type RatingInput = {
  overall: number;
  criteria: Partial<Record<Criterion, number>>;
  dishes: Record<string, number>;
  tags: string[];
  comment: string | null;
};

export function cleanRating(body: Record<string, unknown>, menu: AbetMenu | null): RatingInput | string {
  const overall = score(body.overall);
  if (overall == null) return "Umumiy bahoni (1–5 yulduz) tanlang";
  const criteria: Partial<Record<Criterion, number>> = {};
  const rawCriteria = (body.criteria ?? {}) as Record<string, unknown>;
  for (const c of CRITERIA) {
    const v = score(rawCriteria[c]);
    if (v != null) criteria[c] = v;
  }
  const dishes: Record<string, number> = {};
  const dishNames = new Set((menu?.items ?? []).map((i) => i.name));
  const rawDishes = (body.dishes ?? {}) as Record<string, unknown>;
  for (const [name, v] of Object.entries(rawDishes)) {
    const s = score(v);
    if (s != null && dishNames.has(name)) dishes[name] = s;
  }
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((t) => String(t)).filter((t) => (TAGS as readonly string[]).includes(t)))]
    : [];
  const comment = String(body.comment ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  return { overall, criteria, dishes, tags, comment };
}

export async function upsertRating(day: string, userId: number, input: RatingInput, source: "qr" | "app"): Promise<AbetRating> {
  await ensureAbetSchema();
  const { rows } = await pool.query<RatingRow>(
    `INSERT INTO abet_ratings (day, user_id, overall, criteria, dishes, tags, comment, source)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7, $8)
     ON CONFLICT (day, user_id) DO UPDATE SET
       overall = EXCLUDED.overall, criteria = EXCLUDED.criteria, dishes = EXCLUDED.dishes,
       tags = EXCLUDED.tags, comment = EXCLUDED.comment,
       source = CASE WHEN abet_ratings.source = 'qr' THEN 'qr' ELSE EXCLUDED.source END,
       updated_at = now()
     RETURNING *`,
    [day, userId, input.overall, JSON.stringify(input.criteria), JSON.stringify(input.dishes), input.tags, input.comment, source],
  );
  return toRating(rows[0]!);
}

export async function qrToken(): Promise<string> {
  await ensureAbetSchema();
  const { rows } = await pool.query<{ value: string }>(`SELECT value FROM abet_settings WHERE key = 'qr_token'`);
  if (rows[0]?.value) return rows[0].value;
  return rotateQrToken();
}

export async function rotateQrToken(): Promise<string> {
  await ensureAbetSchema();
  const token = randomBytes(12).toString("base64url");
  await pool.query(
    `INSERT INTO abet_settings (key, value) VALUES ('qr_token', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [token],
  );
  return token;
}

export function qrUrl(token: string, origin: string): string {
  return `${publicAppUrl() || origin}/abet?qr=${encodeURIComponent(token)}`;
}

/** URL yoki xom token — ikkalasidan tokenni ajratadi */
export function tokenFromScan(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.searchParams.get("qr")?.trim() ?? "";
  } catch {
    return s;
  }
}

export type DayRatingRow = AbetRating & {
  fullName: string;
  role: string;
  department: string | null;
};

export type DistItem = { score: number; count: number };

export type DayAnalytics = {
  day: string;
  menu: AbetMenu | null;
  eligible: number;
  responded: number;
  responseRate: number;
  average: number | null;
  distribution: DistItem[];
  criteria: Array<{ key: Criterion; average: number | null; count: number }>;
  dishes: Array<{ name: string; category: DishCategory; average: number | null; count: number }>;
  tags: Array<{ tag: string; count: number }>;
  sources: { qr: number; app: number };
  byDepartment: Array<{ department: string; count: number; average: number }>;
  hourly: Array<{ hm: string; count: number }>;
  ratings: DayRatingRow[];
};

const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);

async function ratingsWithUsers(from: string, to: string): Promise<DayRatingRow[]> {
  await ensureAbetSchema();
  const { rows } = await pool.query<RatingRow & { full_name: string; role: string; department: string | null }>(
    `SELECT r.*, u.full_name, u.role, d.name AS department
     FROM abet_ratings r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE r.day BETWEEN $1 AND $2
     ORDER BY r.day DESC, r.created_at ASC`,
    [from, to],
  );
  return rows.map((r) => ({ ...toRating(r), fullName: r.full_name, role: r.role, department: r.department }));
}

export async function dayAnalytics(day: string): Promise<DayAnalytics> {
  const [menu, ratings, eligibleIds] = await Promise.all([menuFor(day), ratingsWithUsers(day, day), officeUserIds()]);
  const eligible = eligibleIds.length;
  const distribution = [5, 4, 3, 2, 1].map((s) => ({ score: s, count: ratings.filter((r) => r.overall === s).length }));
  const criteria = CRITERIA.map((key) => {
    const xs = ratings.map((r) => r.criteria[key]).filter((v): v is number => typeof v === "number");
    return { key, average: avg(xs), count: xs.length };
  });
  const dishes = (menu?.items ?? []).map((it) => {
    const xs = ratings.map((r) => r.dishes[it.name]).filter((v): v is number => typeof v === "number");
    return { name: it.name, category: it.category, average: avg(xs), count: xs.length };
  });
  const tagMap = new Map<string, number>();
  for (const r of ratings) for (const t of r.tags) tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
  const deptMap = new Map<string, number[]>();
  for (const r of ratings) {
    const k = r.department || "Bo‘limsiz";
    deptMap.set(k, [...(deptMap.get(k) ?? []), r.overall]);
  }
  const hourMap = new Map<string, number>();
  for (const r of ratings) {
    const t = tashkentNow(new Date(r.createdAt));
    const slot = `${String(t.hour).padStart(2, "0")}:${t.minute < 30 ? "00" : "30"}`;
    hourMap.set(slot, (hourMap.get(slot) ?? 0) + 1);
  }
  const hourly = ["12:30", "13:00", "13:30", "14:00", "14:30"].map((hm) => ({ hm, count: hourMap.get(hm) ?? 0 }));
  return {
    day,
    menu,
    eligible,
    responded: ratings.length,
    responseRate: eligible ? Math.round((ratings.length / eligible) * 1000) / 10 : 0,
    average: avg(ratings.map((r) => r.overall)),
    distribution,
    criteria,
    dishes,
    tags: [...tagMap.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
    sources: { qr: ratings.filter((r) => r.source === "qr").length, app: ratings.filter((r) => r.source === "app").length },
    byDepartment: [...deptMap.entries()]
      .map(([department, xs]) => ({ department, count: xs.length, average: avg(xs) ?? 0 }))
      .sort((a, b) => b.count - a.count),
    hourly,
    ratings,
  };
}

export type RangeDay = {
  day: string;
  responded: number;
  average: number | null;
  approved: boolean;
  items: string[];
};

export type RangeAnalytics = {
  from: string;
  to: string;
  eligible: number;
  days: RangeDay[];
  totalResponses: number;
  average: number | null;
  topDishes: Array<{ name: string; average: number; count: number; days: number }>;
  bottomDishes: Array<{ name: string; average: number; count: number; days: number }>;
};

export async function rangeAnalytics(from: string, to: string): Promise<RangeAnalytics> {
  const [menus, ratings, eligibleIds] = await Promise.all([menusBetween(from, to), ratingsWithUsers(from, to), officeUserIds()]);
  const byDay = new Map<string, DayRatingRow[]>();
  for (const r of ratings) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  const menuByDay = new Map(menus.map((m) => [m.day, m]));
  const allDays = [...new Set([...menuByDay.keys(), ...byDay.keys()])].sort((a, b) => b.localeCompare(a));
  const days = allDays.map((day) => {
    const rs = byDay.get(day) ?? [];
    const m = menuByDay.get(day);
    return {
      day,
      responded: rs.length,
      average: avg(rs.map((r) => r.overall)),
      approved: m?.status === "approved",
      items: (m?.items ?? []).map((i) => i.name),
    };
  });
  const dishMap = new Map<string, { scores: number[]; days: Set<string> }>();
  for (const r of ratings) {
    for (const [name, s] of Object.entries(r.dishes)) {
      const cur = dishMap.get(name) ?? { scores: [], days: new Set<string>() };
      cur.scores.push(s);
      cur.days.add(r.day);
      dishMap.set(name, cur);
    }
  }
  const dishes = [...dishMap.entries()]
    .filter(([, v]) => v.scores.length >= 2)
    .map(([name, v]) => ({ name, average: avg(v.scores) ?? 0, count: v.scores.length, days: v.days.size }));
  return {
    from,
    to,
    eligible: eligibleIds.length,
    days,
    totalResponses: ratings.length,
    average: avg(ratings.map((r) => r.overall)),
    topDishes: [...dishes].sort((a, b) => b.average - a.average || b.count - a.count).slice(0, 5),
    bottomDishes: [...dishes].sort((a, b) => a.average - b.average || b.count - a.count).slice(0, 5),
  };
}

export async function exportRatings(from: string, to: string): Promise<{ menus: AbetMenu[]; ratings: DayRatingRow[] }> {
  const [menus, ratings] = await Promise.all([menusBetween(from, to), ratingsWithUsers(from, to)]);
  return { menus, ratings };
}

export const CRITERIA_LABEL: Record<Criterion, string> = {
  taste: "Ta’mi",
  portion: "Porsiya",
  temperature: "Issiqligi",
  cleanliness: "Tozalik",
  service: "Xizmat",
};
