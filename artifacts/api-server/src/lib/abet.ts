import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { hasFullPlatformAccess, isHrRole } from "./roles";
import { tashkentNow } from "./davomat-shift-report";
import { notifyUser } from "./notify";
import { escapeHtml, isTelegramConfigured, notificationOpenKeyboard, publicAppUrl, sendMessage } from "./telegram";
import { loadWorkCalendar, scopeDayStatus } from "./work-calendar";
import { logger } from "./logger";

/** Dorixona tarmog‘i va o‘quvchilar — abet faqat ofis (ofis, distribyutsiya, ombor, oshxona …) uchun */
const NON_OFFICE_ROLES = ["mudir", "farmasevt", "stajyor", "koordinator", "oquvchi"];

export const RATE_OPEN_HM = "12:30";
export const RATE_CLOSE_HM = "15:00";
/** Oshpazlar bugungi menyuni shu vaqtgacha tasdiqlashi kerak — xodimlar 11:00 gacha xabardor bo‘ladi */
export const MENU_DEADLINE_HM = "11:00";

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

/** Tahlil: admin, direktor, HR va barcha oshpazlar (oshpaz/direktorga — anonim) */
export function canViewAbetAnalytics(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return hasFullPlatformAccess(r) || isHrRole(r) || r === "oshpaz_rahbar" || r === "oshpaz";
}

/** Kim baho berganini (ism, bo‘lim) faqat admin, asoschi va HR ko‘radi */
export function canSeeAbetRaters(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return r === "admin" || r === "asoschi" || isHrRole(r);
}

export function canManageAbetQr(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return hasFullPlatformAccess(r) || isHrRole(r) || r === "oshpaz_rahbar";
}

function anonymize<T extends DayRatingRow>(rows: T[]): DayRatingRow[] {
  return rows.map((r, i) => ({ ...r, id: i + 1, userId: 0, fullName: "Anonim", role: "", department: null }));
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
  menuDeadline: string;
};

export function rateWindow(d = new Date()): RateWindow {
  const t = tashkentNow(d);
  const state = t.hm < RATE_OPEN_HM ? "before" : t.hm < RATE_CLOSE_HM ? "open" : "closed";
  return { day: t.ymd, now: t.hm, opensAt: RATE_OPEN_HM, closesAt: RATE_CLOSE_HM, state, menuDeadline: MENU_DEADLINE_HM };
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

const CATEGORY_EMOJI: Record<DishCategory, string> = {
  birinchi: "🥣",
  ikkinchi: "🍛",
  salat: "🥗",
  garnir: "🍚",
  non: "🫓",
  ichimlik: "🍵",
  shirinlik: "🍰",
  boshqa: "🍽",
};

const WEEKDAYS_UZ = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const MONTHS_UZ = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

function dayTitle(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.getUTCDate()}-${MONTHS_UZ[d.getUTCMonth()]}, ${WEEKDAYS_UZ[d.getUTCDay()]}`;
}

const DIVIDER = "━━━━━━━━━━━━━━━━";

/** Platforma ichidagi xabar va telefon push uchun oddiy matn */
export function menuMessage(menu: AbetMenu, update: boolean): string {
  const lines = menu.items.map(
    (it) => `${CATEGORY_EMOJI[it.category]} ${it.name}${it.category !== "boshqa" ? ` — ${CATEGORY_LABEL[it.category]}` : ""}`,
  );
  return [
    update ? "🔄 Abet menyusi yangilandi! Bugun abetda quyidagilar:" : "🍽 Bugun abetda quyidagilar:",
    `📅 ${dayTitle(menu.day)}`,
    "",
    ...lines,
    ...(menu.note ? ["", `📝 ${menu.note}`] : []),
    "",
    `⭐ Baholash: bugun ${RATE_OPEN_HM}–${RATE_CLOSE_HM} — oshxonadagi QR kod yoki «Abet» → «Bugun».`,
    "Yoqimli ishtaha! 😊",
  ].join("\n");
}

/** Telegram (HTML) — frontend `TelegramMenuBubble` bilan bir xil ko‘rinish */
export function menuTelegramHtml(menu: AbetMenu, update: boolean): string {
  const lines = menu.items.map(
    (it) =>
      `${CATEGORY_EMOJI[it.category]} <b>${escapeHtml(it.name)}</b>${it.category !== "boshqa" ? `  <i>· ${CATEGORY_LABEL[it.category]}</i>` : ""}`,
  );
  return [
    update ? "🔄 <b>ABET MENYUSI YANGILANDI</b>" : "🍽 <b>BUGUN ABETDA QUYIDAGILAR</b>",
    `📅 <i>${dayTitle(menu.day)}</i>`,
    DIVIDER,
    ...lines,
    DIVIDER,
    ...(menu.note ? [`📝 ${escapeHtml(menu.note)}`, ""] : []),
    `⭐ <b>Baholash:</b> bugun <b>${RATE_OPEN_HM}–${RATE_CLOSE_HM}</b>`,
    "📷 Oshxonadagi QR kodni skaner qiling yoki «Abet» bo‘limida «Bugun»ni tanlang",
    "",
    "<i>Yoqimli ishtaha!</i> 😊",
  ].join("\n");
}

export async function officeUsers(): Promise<Array<{ id: number; telegramId: string | null }>> {
  const { rows } = await pool.query<{ id: number; telegram_id: string | null }>(
    `SELECT id, telegram_id FROM users WHERE status = 'active' AND NOT (lower(role) = ANY($1::text[]))`,
    [NON_OFFICE_ROLES],
  );
  return rows.map((r) => ({ id: r.id, telegramId: r.telegram_id }));
}

export async function officeUserIds(): Promise<number[]> {
  return (await officeUsers()).map((u) => u.id);
}

async function sendTelegramHtml(telegramId: string | null, html: string, buttonText: string): Promise<void> {
  if (!telegramId || !isTelegramConfigured()) return;
  await sendMessage(telegramId, html, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: notificationOpenKeyboard("/abet", buttonText),
  });
}

/** Bir kunda bir marta — bir nechta server nusxasida ham takrorlanmaydi */
async function claimOnce(key: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO abet_settings (key, value) VALUES ($1, now()::text) ON CONFLICT (key) DO NOTHING`,
    [key],
  );
  return (rowCount ?? 0) > 0;
}

async function cookUsers(): Promise<Array<{ id: number; telegramId: string | null; role: string }>> {
  const { rows } = await pool.query<{ id: number; telegram_id: string | null; role: string }>(
    `SELECT id, telegram_id, role FROM users WHERE status = 'active' AND lower(role) IN ('oshpaz', 'oshpaz_rahbar')`,
  );
  return rows.map((r) => ({ id: r.id, telegramId: r.telegram_id, role: r.role }));
}

async function notifyCooks(html: string, plain: string): Promise<void> {
  for (const c of await cookUsers()) {
    try {
      await notifyUser({ userId: c.id, text: plain, type: "abet_deadline", linkUrl: "/abet", telegram: false, title: "Abet menyusi" });
      await sendTelegramHtml(c.telegramId, html, "📝 Menyuni kiritish");
    } catch (err) {
      logger.warn({ err, userId: c.id }, "Oshpazga eslatma yuborilmadi");
    }
  }
}

/** Ish kunlari: 09:00 va 10:30 — oshpazlarga eslatma, 11:00 — kechikish ogohlantirishi */
export async function remindCooksIfNeeded(): Promise<void> {
  await ensureAbetSchema();
  const win = rateWindow();
  const stage =
    win.now >= "09:00" && win.now < "10:30"
      ? "remind1"
      : win.now >= "10:30" && win.now < MENU_DEADLINE_HM
        ? "remind2"
        : win.now >= MENU_DEADLINE_HM && win.now < RATE_OPEN_HM
          ? "late"
          : null;
  if (!stage) return;
  await loadWorkCalendar();
  if (scopeDayStatus("ofis", win.day)?.work === false) return;
  const menu = await menuFor(win.day);
  if (menu?.status === "approved") return;
  if (!(await claimOnce(`notice:${win.day}:${stage}`))) return;

  const title = dayTitle(win.day);
  if (stage === "late") {
    await notifyCooks(
      [
        "❗️ <b>BUGUNGI MENYU KECHIKDI</b>",
        `📅 <i>${title}</i>`,
        DIVIDER,
        `Menyu soat <b>${MENU_DEADLINE_HM}</b> gacha kiritilib tasdiqlanishi kerak edi.`,
        "Xodimlar bugun nima ovqat bo‘lishini hali bilishmaydi — iltimos, menyuni <b>hoziroq</b> kiriting va tasdiqlang.",
      ].join("\n"),
      `❗️ Bugungi abet menyusi ${MENU_DEADLINE_HM} gacha tasdiqlanmadi. Iltimos, hoziroq kiriting va tasdiqlang.`,
    );
    return;
  }
  const left = stage === "remind1" ? "2 soat" : "30 daqiqa";
  await notifyCooks(
    [
      stage === "remind1" ? "⏰ <b>BUGUNGI ABET MENYUSINI KIRITING</b>" : "⚠️ <b>MENYU UCHUN 30 DAQIQA QOLDI</b>",
      `📅 <i>${title}</i>`,
      DIVIDER,
      `Bugungi menyuni soat <b>${MENU_DEADLINE_HM}</b> gacha kiriting va <b>«Tasdiqlash»</b> tugmasini bosing.`,
      `⌛ Qolgan vaqt: <b>${left}</b>`,
      "",
      "✅ Tasdiqlangach barcha ofis xodimlariga bot orqali «Bugun abetda quyidagilar…» xabari avtomatik boradi.",
    ].join("\n"),
    `⏰ Bugungi abet menyusini ${MENU_DEADLINE_HM} gacha kiriting va tasdiqlang (qoldi: ${left}). Tasdiqlangach barcha xodimlarga xabar boradi.`,
  );
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
  const users = await officeUsers();
  await pool.query(`UPDATE abet_menus SET notified_at = now() WHERE day = $1`, [menu.day]);
  const text = menuMessage(menu, update);
  const html = menuTelegramHtml(menu, update);
  void (async () => {
    for (const u of users) {
      try {
        await notifyUser({ userId: u.id, text, type: "abet_menu", linkUrl: "/abet", telegram: false, title: "🍽 Bugungi abet" });
        await sendTelegramHtml(u.telegramId, html, "🍽 Menyu va baholash");
      } catch (err) {
        logger.warn({ err, userId: u.id }, "Abet menyusi yuborilmadi");
      }
    }
  })();
  return users.length;
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

export async function dayAnalytics(day: string, anonymous = false): Promise<DayAnalytics> {
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
    byDepartment: anonymous
      ? []
      : [...deptMap.entries()]
          .map(([department, xs]) => ({ department, count: xs.length, average: avg(xs) ?? 0 }))
          .sort((a, b) => b.count - a.count),
    hourly,
    ratings: anonymous ? anonymize(ratings) : ratings,
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

export async function exportRatings(
  from: string,
  to: string,
  anonymous = false,
): Promise<{ menus: AbetMenu[]; ratings: DayRatingRow[] }> {
  const [menus, ratings] = await Promise.all([menusBetween(from, to), ratingsWithUsers(from, to)]);
  return { menus, ratings: anonymous ? anonymize(ratings) : ratings };
}

export const CRITERIA_LABEL: Record<Criterion, string> = {
  taste: "Ta’mi",
  portion: "Porsiya",
  temperature: "Issiqligi",
  cleanliness: "Tozalik",
  service: "Xizmat",
};
