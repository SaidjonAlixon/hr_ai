/**
 * Yordamchi AI — @vaksinahrbot orqali suhbat.
 *
 * Qoidalar (egasi talabi):
 *  - XODIMLAR: AI (OpenAI) UMUMAN ishlatilmaydi — javob faqat bazadan, kod bilan tayyorlanadi:
 *    o‘z davomati (kirdi-chiqdi), test holati/jadvali, javob olish holati. Chat/vazifa/amal — YO‘Q.
 *  - ADMIN (yagona boshqaruvchi): AI faqat u yozganda «o‘ylash» uchun ishlatiladi; nima desa — jonli bazadan javob, amal darhol bajariladi
 *    (test qayta ochish, davomat tuzatish, xabar yuborish), so‘rasa PDF/Excel fayl ham tayyorlab yuboriladi.
 *  - Xodim qaysi tilda / yozuvda (lotin, kirill, rus) yozsa — javob ham o‘shanda.
 *  - Ovozli xabar: eshitolmasligini aytib, yozib yuborishni so‘raydi.
 *  - Parol so‘ramaydi; yuborilsa — ogohlantiradi.
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  pool,
  db,
  usersTable,
  employeesTable,
  attendanceRecordsTable,
  attestatsiyaAttemptsTable,
  attestatsiyaExamsTable,
  javobOlishRequestsTable,
} from "@workspace/db";
import { loadPlatformHelpKnowledge } from "./platform-help-kb";
import { resolveUserBranches } from "./employee-branch";
import { logger } from "./logger";
import { deleteMessage, sendDocument, sendMessage, type TelegramMessage } from "./telegram";
import type { AssistantFileRequest } from "./ai-assistant-files";

/* ------------------------------------------------------------------ schema */

let schemaReady: Promise<void> | null = null;

export function ensureAiAssistantSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_assistant_conversations (
          id SERIAL PRIMARY KEY,
          telegram_user_id TEXT NOT NULL,
          telegram_chat_id TEXT NOT NULL,
          business_connection_id TEXT,
          chat_type TEXT NOT NULL DEFAULT 'private',
          display_name TEXT,
          username TEXT,
          platform_user_id INTEGER,
          status TEXT NOT NULL DEFAULT 'active',
          intent TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ai_conv_tg_idx ON ai_assistant_conversations (telegram_user_id, telegram_chat_id);
        CREATE INDEX IF NOT EXISTS ai_conv_status_idx ON ai_assistant_conversations (status, updated_at DESC);
        CREATE TABLE IF NOT EXISTS ai_assistant_messages (
          id SERIAL PRIMARY KEY,
          conversation_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ai_msg_conv_idx ON ai_assistant_messages (conversation_id, id);
        CREATE TABLE IF NOT EXISTS ai_assistant_proposals (
          id SERIAL PRIMARY KEY,
          conversation_id INTEGER NOT NULL,
          platform_user_id INTEGER,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'pending',
          decided_by_id INTEGER,
          decided_at TIMESTAMPTZ,
          decision_note TEXT,
          execution_result TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ai_prop_status_idx ON ai_assistant_proposals (status, created_at DESC);
        CREATE TABLE IF NOT EXISTS ai_assistant_business_connections (
          connection_id TEXT PRIMARY KEY,
          telegram_user_id TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS ai_assistant_group_settings (
          chat_id TEXT PRIMARY KEY,
          title TEXT,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_by TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/* ------------------------------------------------------------------- types */

export type AiProposalKind = "davomat_fix" | "atestatsiya_retake" | "account_help" | "admin_task" | "notify_user";

export type AiTurnResult = {
  reply: string;
  intent: string;
  proposal: {
    kind: AiProposalKind;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
    completionText?: string;
  } | null;
  /** Faqat admin rejimida: tayyorlanadigan fayl so'rovi (PDF/Excel) */
  file?: AssistantFileRequest | null;
  /** Web chat uchun tayyor fayl (base64) — Telegramda to'g'ridan-to'g'ri yuboriladi */
  fileData?: { name: string; mime: string; base64: string } | null;
};

type ConvRow = {
  id: number;
  telegram_user_id: string;
  telegram_chat_id: string;
  business_connection_id: string | null;
  chat_type: string;
  display_name: string | null;
  username: string | null;
  platform_user_id: number | null;
  status: string;
  intent: string | null;
};

/* ------------------------------------------------------- ruxsat nazorati */

/**
 * Bot FAQAT bitta odamga — adminga tegishli:
 *  - Business (akkaunt) rejimi: faqat admin Telegram ID siga ulangan ulanish ishlaydi.
 *    AI_ADMIN_TELEGRAM_IDS (.env, vergul bilan) berilsa — o‘sha IDlar, berilmasa —
 *    bazada roli `admin` va telegram_id bog‘langan foydalanuvchi.
 *  - Botning shaxsiy chatida: faqat botga login bilan bog‘langan xodim (telegram_id)
 *    yoki admin. Begona odam AI ni ishlatolmaydi (xarajat ham, ma’lumot ham yopiq).
 */
export async function isAiAdminTelegramId(telegramUserId: string): Promise<boolean> {
  const env = (process.env.AI_ADMIN_TELEGRAM_IDS || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (env.length) return env.includes(telegramUserId);
  const [u] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.telegramId, telegramUserId), eq(usersTable.role, "admin")))
    .limit(1);
  return Boolean(u);
}

export async function registerBusinessConnection(connection: {
  id: string;
  user: { id: number };
  is_enabled: boolean;
}): Promise<void> {
  await ensureAiAssistantSchema();
  await pool.query(
    `INSERT INTO ai_assistant_business_connections (connection_id, telegram_user_id, enabled, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (connection_id) DO UPDATE SET telegram_user_id=$2, enabled=$3, updated_at=NOW()`,
    [connection.id, String(connection.user.id), connection.is_enabled],
  );
}

async function businessConnectionAllowed(connectionId: string): Promise<boolean> {
  const { rows } = await pool.query<{ telegram_user_id: string; enabled: boolean }>(
    `SELECT telegram_user_id, enabled FROM ai_assistant_business_connections WHERE connection_id = $1`,
    [connectionId],
  );
  const row = rows[0];
  if (!row || !row.enabled) return false;
  return isAiAdminTelegramId(row.telegram_user_id);
}

/* ------------------------------------------------------ guruh boshqaruvi */

/** Guruh ilk marotaba ko‘rinsa ro‘yxatga olinadi (standart: yoqilgan) */
async function ensureGroupRow(chatId: string, title: string | null): Promise<boolean> {
  await ensureAiAssistantSchema();
  await pool.query(
    `INSERT INTO ai_assistant_group_settings (chat_id, title) VALUES ($1,$2)
     ON CONFLICT (chat_id) DO UPDATE SET title = COALESCE(EXCLUDED.title, ai_assistant_group_settings.title)`,
    [chatId, title],
  );
  const { rows } = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM ai_assistant_group_settings WHERE chat_id = $1`,
    [chatId],
  );
  return rows[0]?.enabled ?? true;
}

export async function listAiGroups(): Promise<
  Array<{ chatId: string; title: string | null; enabled: boolean; updatedAt: string }>
> {
  await ensureAiAssistantSchema();
  const { rows } = await pool.query<{ chat_id: string; title: string | null; enabled: boolean; updated_at: string }>(
    `SELECT chat_id, title, enabled, updated_at FROM ai_assistant_group_settings ORDER BY updated_at DESC LIMIT 100`,
  );
  return rows.map((r) => ({ chatId: r.chat_id, title: r.title, enabled: r.enabled, updatedAt: r.updated_at }));
}

export async function setAiGroupEnabled(chatId: string, enabled: boolean, updatedBy?: string | null): Promise<void> {
  await ensureAiAssistantSchema();
  await pool.query(
    `INSERT INTO ai_assistant_group_settings (chat_id, enabled, updated_by, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (chat_id) DO UPDATE SET enabled=$2, updated_by=$3, updated_at=NOW()`,
    [chatId, enabled, updatedBy ?? null],
  );
}

const GROUP_TOGGLE_RE = /^\/(bot_on|bot_off|yordamchi_on|yordamchi_off)(?:@\w+)?\b/i;

/**
 * Guruh darvozasi. true — xabar shu yerda tugadi (keyingi handlerlar javob bermaydi):
 *  - Admin guruhda /bot_on yoki /bot_off yozsa — jim bajariladi (guruhga javob YO‘Q,
 *    tasdiq adminning shaxsiy chatiga boradi). Boshqalar bu buyruqni berolmaydi.
 *  - Admin guruhda oddiy xabar yozsa — bot javob bermaydi.
 *  - Guruh o‘chirilgan bo‘lsa — hech kimga javob berilmaydi.
 * false — xodim, guruh yoqilgan: odatiy oqim davom etadi.
 */
export async function handleAiGroupGate(msg: TelegramMessage): Promise<boolean> {
  if (!msg.from || msg.from.is_bot) return false;
  const chat = msg.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;
  const chatId = String(chat.id);
  const title = chat.title || null;
  const enabledNow = await ensureGroupRow(chatId, title).catch(() => true);
  const text = (msg.text ?? msg.caption ?? "").trim();

  const adminTg = await isAiAdminTelegramId(String(msg.from.id)).catch(() => false);
  const linked = adminTg ? null : await findUserByTelegram(String(msg.from.id)).catch(() => null);
  const isAdmin = adminTg || linked?.role === "admin";

  const toggle = text.match(GROUP_TOGGLE_RE);
  if (toggle) {
    if (!isAdmin) return true; // faqat admin yoqib-o‘chiradi; boshqalarga javob ham berilmaydi
    const enabled = /on$/i.test(toggle[1]!);
    await setAiGroupEnabled(chatId, enabled, String(msg.from.id)).catch(() => {});
    await deleteMessage(chat.id, msg.message_id).catch(() => {});
    await sendMessage(
      msg.from.id,
      enabled
        ? `✅ «${title || "Guruh"}»da bot YOQILDI. Xodimlar standart so‘rov yozsa javob beradi; sizga guruhda javob bermaydi.`
        : `🔕 «${title || "Guruh"}»da bot O‘CHIRILDI. Endi guruhda hech kimga javob bermaydi. Qayta yoqish: shu guruhda /bot_on yozing yoki Yordamchi AI bo‘limi.`,
    ).catch(() => {});
    return true;
  }

  if (isAdmin) return true; // guruhda adminga javob berilmaydi
  if (!enabledNow) return true; // o‘chirilgan guruh — jim
  return false;
}

/* ------------------------------------------------------------------- matn */

const CYRILLIC_RE = /[\u0400-\u04FF]/;

export function detectScript(text: string): "cyrl" | "latn" {
  return CYRILLIC_RE.test(text) ? "cyrl" : "latn";
}

export function looksLikeVoiceComplaint(text: string): boolean {
  return /ovoz|голос|voice/i.test(text);
}

const PASSWORD_HINT_RE =
  /(parol|пароль|password)\s*[:=]?\s+\S{3,}|login\s+\S+\s+\S{3,}/i;

function senderDisplayName(msg: TelegramMessage): string {
  const f = msg.from;
  if (!f) return "Foydalanuvchi";
  return [f.first_name, f.last_name].filter(Boolean).join(" ") || (f.username ? `@${f.username}` : "Foydalanuvchi");
}

/* ------------------------------------------------------------- baza lookup */

type PlatformUser = {
  id: number;
  fullName: string;
  role: string;
  login: string;
  phone: string | null;
  status: string;
  telegramId: string | null;
};

async function findUserByTelegram(telegramUserId: string): Promise<PlatformUser | null> {
  const [u] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      login: usersTable.login,
      phone: usersTable.phone,
      status: usersTable.status,
      telegramId: usersTable.telegramId,
    })
    .from(usersTable)
    .where(eq(usersTable.telegramId, telegramUserId))
    .limit(1);
  return u ?? null;
}

/* ------------------------------------------------ odam topish (ball + fuzzy) */

/**
 * Admin odam yozsa — tizimning o‘zi topishi shart («agentcha» ishlash).
 * Eski usul (substring oyna) «ber» kabi oddiy so‘zlar familiyaga tegib
 * tasodifiy odamlarni chiqarardi. Endi: stop-so‘zlar tashlanadi, har bir
 * xodim ism tokenlari bo‘yicha ball oladi (aniq / prefiks / fuzzy),
 * rol ishorasi (hr, farmasevt...) bonus beradi. Xato yozilgan ism ham topiladi.
 */
const NAME_STOPWORDS = new Set([
  "menga", "uchun", "bilan", "kerak", "qilib", "qil", "ber", "bering", "berib", "topib", "top", "toping",
  "xodim", "xodimlar", "xodimlari", "xodimni", "ichidan", "ofis", "ofisdagi", "hafta", "haftalik", "haftalikni",
  "kun", "kuni", "kunlik", "davomat", "davomatini", "davomatim", "davomati", "excel", "pdf", "fayl", "faylni",
  "ish", "ishi", "ishini", "yozib", "yubor", "yuboring", "yuborib", "ochib", "och", "oching", "tuzat", "tuzating",
  "nima", "qaysi", "qanday", "bugun", "bugungi", "kecha", "ertaga", "soat", "nechida", "haqida", "boyicha",
  "ham", "hamda", "va", "ni", "ning", "ga", "da", "dan", "lar", "lari", "bir", "shu", "ushbu", "iltimos", "rahmat",
  "менга", "учун", "билан", "керак", "қилиб", "қил", "бер", "беринг", "топиб", "ходим", "ходимлар", "ичидан",
  "ҳафта", "ҳафталик", "кун", "куни", "давомат", "давоматини", "excel", "pdf", "файл", "иш", "иши", "ёзиб",
  "юбор", "юборинг", "очиб", "оч", "тузат", "нима", "қайси", "бугун", "кеча", "эртага", "соат", "нечида",
  "ҳақида", "ҳам", "ва", "ни", "нинг", "га", "да", "дан", "лар", "лари", "бир", "шу", "илтимос",
  "the", "please", "give", "me", "file", "make", "send", "for", "and", "with", "week", "weekly", "today",
  "мне", "для", "сделай", "дай", "нужен", "нужна", "файл", "неделю", "недели", "сегодня", "пожалуйста",
  "работник", "сотрудник", "сотрудники", "из", "офис", "офиса",
]);

function nameQueryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]!;
}

/** Bitta so‘z ↔ ism bo‘lagi o‘xshashligi: aniq=3, prefiks=2.2, ichida=1.8, fuzzy=1.6/1.2 */
function tokenScore(q: string, n: string): number {
  if (!q || !n) return 0;
  if (q === n) return 3;
  if (q.length >= 4 && n.length >= 4 && (q.startsWith(n) || n.startsWith(q))) return 2.2;
  if (q.length >= 5 && n.length >= 5 && (q.includes(n) || n.includes(q))) return 1.8;
  const min = Math.min(q.length, n.length);
  const d = levenshtein(q, n);
  if (d <= 1 && min >= 4) return 1.6;
  if (d <= 2 && min >= 6) return 1.2;
  return 0;
}

const ROLE_HINTS: Array<{ re: RegExp; role: string }> = [
  { re: /\bhr\b|эйчар/i, role: "hr" },
  { re: /farmasevt|фармацевт/i, role: "farmasevt" },
  { re: /mudir|мудир|заведующ/i, role: "mudir" },
  { re: /direktor|директор/i, role: "director" },
  { re: /koordinator|координатор/i, role: "koordinator" },
  { re: /stajyor|стаж[её]р|стажер/i, role: "stajyor" },
  { re: /rekruter|recruiter|рекрутер/i, role: "recruiter" },
  { re: /mentor|ментор/i, role: "mentor" },
  { re: /trener|trainer|тренер/i, role: "trainer" },
];

let allUsersCache: { at: number; users: PlatformUser[] } | null = null;

async function loadAllUsersForMatch(): Promise<PlatformUser[]> {
  if (allUsersCache && Date.now() - allUsersCache.at < 60_000) return allUsersCache.users;
  const rows = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      login: usersTable.login,
      phone: usersTable.phone,
      status: usersTable.status,
      telegramId: usersTable.telegramId,
    })
    .from(usersTable)
    .limit(5000);
  allUsersCache = { at: Date.now(), users: rows };
  return rows;
}

/** Matndan odam topish: ishonchli bo‘lsa user, yaqin bir nechta bo‘lsa candidates */
export async function searchUsersInText(
  text: string,
): Promise<{ user: PlatformUser | null; candidates: PlatformUser[] }> {
  const qTokens = nameQueryTokens(text);
  if (!qTokens.length) return { user: null, candidates: [] };
  const users = await loadAllUsersForMatch().catch(() => [] as PlatformUser[]);
  if (!users.length) return { user: null, candidates: [] };
  const hint = ROLE_HINTS.find((h) => h.re.test(text))?.role;

  const scored: Array<{ u: PlatformUser; score: number }> = [];
  for (const u of users) {
    const parts = u.fullName
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
    let score = 0;
    for (const part of parts) {
      let best = 0;
      for (const q of qTokens) best = Math.max(best, tokenScore(q, part));
      score += best;
    }
    const login = (u.login || "").toLowerCase();
    if (login && qTokens.some((q) => q === login)) score += 3;
    if (hint && u.role === hint) score += 1.5;
    if (score >= 1.2) scored.push({ u, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return { user: null, candidates: [] };
  const close = scored.filter((s) => top.score - s.score < 0.9).slice(0, 5);
  if (close.length === 1 && top.score >= 1.6) return { user: top.u, candidates: [] };
  if (top.score >= 1.2) return { user: null, candidates: close.map((s) => s.u) };
  return { user: null, candidates: [] };
}

/** Admin (yoki business) matnlaridan nishon xodimni topish; bir nechta bo‘lsa — nomzodlar */
export async function resolveTargetFromTexts(
  texts: string[],
): Promise<{ user: PlatformUser | null; candidates: PlatformUser[] }> {
  for (const t of texts) {
    const r = await searchUsersInText(t).catch(
      () => ({ user: null, candidates: [] }) as { user: PlatformUser | null; candidates: PlatformUser[] },
    );
    if (r.user) return { user: r.user, candidates: [] };
    if (r.candidates.length) return { user: null, candidates: r.candidates };
  }
  return { user: null, candidates: [] };
}

async function extractMentionedUser(historyText: string, self: PlatformUser | null): Promise<PlatformUser | null> {
  if (self) return self;
  const { user } = await resolveTargetFromTexts(historyText.split(/\n/).slice(-6).reverse());
  return user;
}

/* ------------------------------------------------------------ amal ijrosi */

/**
 * Amalni bajarish. Xodim so‘rovida — FAQAT admin tasdiqlagach chaqiriladi.
 * Admin o‘zi buyruq berganda — darhol chaqiriladi.
 */
export async function executeAssistantAction(opts: {
  kind: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  platformUserId: number | null;
  proposalId?: number;
}): Promise<string> {
  const payload = opts.payload || {};
  const userId = opts.platformUserId ?? (Number(payload.userId) || null);
  const { notifyUser, notifyByRoles } = await import("./notify");

  if (opts.kind === "notify_user") {
    if (!userId) throw new Error("Xodim aniqlanmagan");
    const message = String(payload.message || opts.summary || opts.title).slice(0, 1500);
    await notifyUser({
      userId,
      title: "Xabar",
      text: message,
      type: "ai_assistant",
      linkUrl: "/dashboard",
    });
    return "Xodimga xabar yuborildi (platforma + Telegram).";
  }

  if (opts.kind === "atestatsiya_retake") {
    if (!userId) throw new Error("Xodim aniqlanmagan — avval xodimni aniqlang");
    const examId = Number(payload.examId) || null;
    const attempts = await db
      .select()
      .from(attestatsiyaAttemptsTable)
      .where(eq(attestatsiyaAttemptsTable.userId, userId))
      .orderBy(desc(attestatsiyaAttemptsTable.startedAt));
    const target =
      (examId ? attempts.find((a) => a.examId === examId) : undefined) ??
      attempts.find((a) => a.passed === false) ??
      attempts[0];
    if (!target) return "Urinish topilmadi — test hali boshlanmagan, xodim testni odatdagidek boshlay oladi.";
    if (target.passed === true) throw new Error("Xodim bu testdan o‘tgan — qayta ochish kerak emas");
    await db
      .update(attestatsiyaAttemptsTable)
      .set({ retakeAllowed: true, retakeGrantedAt: new Date(), updatedAt: new Date() })
      .where(eq(attestatsiyaAttemptsTable.id, target.id));
    return `Atestatsiya qayta topshirish ochildi (urinish #${target.id}).`;
  }

  if (opts.kind === "davomat_fix") {
    if (!userId) throw new Error("Xodim aniqlanmagan — avval xodimni aniqlang");
    const workDate = String(payload.workDate || "").trim();
    const checkIn = payload.checkInAt ? new Date(String(payload.checkInAt)) : null;
    const checkOut = payload.checkOutAt ? new Date(String(payload.checkOutAt)) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || (!checkIn && !checkOut)) {
      throw new Error("Davomat tuzatish uchun sana va vaqtlar yetarli emas — sana/vaqtni aniqlashtiring.");
    }
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    if (!emp) throw new Error("Xodim kartochkasi (employee) topilmadi");
    const [existing] = await db
      .select()
      .from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, emp.id), eq(attendanceRecordsTable.workDate, workDate)))
      .limit(1);
    const note = `Yordamchi AI${opts.proposalId ? ` #${opts.proposalId}` : ""}: admin buyrug'i/tasdig'i. ${String(payload.note || opts.summary).slice(0, 300)}`;
    if (existing) {
      await db
        .update(attendanceRecordsTable)
        .set({
          checkInAt: checkIn ?? existing.checkInAt,
          checkOutAt: checkOut ?? existing.checkOutAt,
          source: "manual",
          notes: note,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecordsTable.id, existing.id));
    } else {
      await db.insert(attendanceRecordsTable).values({
        employeeId: emp.id,
        userId,
        workDate,
        checkInAt: checkIn,
        checkOutAt: checkOut,
        status: "present",
        source: "manual",
        notes: note,
      });
    }
    return `Davomat ${workDate} uchun tuzatildi.`;
  }

  // account_help / admin_task
  await notifyByRoles({
    roles: ["admin"],
    title: "Yordamchi AI — amal",
    text: `${opts.title}: ${opts.summary}`.slice(0, 900),
    type: "ai_assistant",
    linkUrl: "/admin/yordamchi-ai",
  }).catch(() => undefined);
  if (userId) {
    await notifyUser({
      userId,
      title: "So‘rovingiz bajarildi",
      text: opts.title,
      type: "ai_assistant",
      linkUrl: "/dashboard",
    }).catch(() => undefined);
  }
  return "Adminlarga vazifa yuborildi / xodim xabardor qilindi.";
}

/** Taklifni yozib, admin rejimida darhol bajarish yoki xodim rejimida pending qoldirish */
async function recordProposal(
  conv: ConvRow,
  platformUserId: number | null,
  proposal: NonNullable<AiTurnResult["proposal"]>,
  mode: "pending" | "executed",
  decidedById?: number | null,
): Promise<{ id: number; executionResult?: string; error?: string }> {
  if (mode === "pending") {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO ai_assistant_proposals (conversation_id, platform_user_id, kind, title, summary, payload)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        conv.id,
        platformUserId,
        proposal.kind,
        proposal.title,
        proposal.summary,
        JSON.stringify({ ...proposal.payload, completionText: proposal.completionText || null }),
      ],
    );
    await pool.query(`UPDATE ai_assistant_conversations SET status='waiting_admin', updated_at=NOW() WHERE id=$1`, [conv.id]);
    return { id: ins.rows[0]!.id };
  }
  const ins = await pool.query<{ id: number }>(
    `INSERT INTO ai_assistant_proposals (conversation_id, platform_user_id, kind, title, summary, payload, status, decided_by_id, decided_at, decision_note)
     VALUES ($1,$2,$3,$4,$5,$6,'approved',$7,NOW(),'admin buyrug‘i') RETURNING id`,
    [
      conv.id,
      platformUserId,
      proposal.kind,
      proposal.title,
      proposal.summary,
      JSON.stringify({ ...proposal.payload, completionText: proposal.completionText || null }),
      decidedById ?? null,
    ],
  );
  const pid = ins.rows[0]!.id;
  try {
    const result = await executeAssistantAction({
      kind: proposal.kind,
      title: proposal.title,
      summary: proposal.summary,
      payload: proposal.payload,
      platformUserId,
      proposalId: pid,
    });
    await pool.query(`UPDATE ai_assistant_proposals SET status='executed', execution_result=$2 WHERE id=$1`, [pid, result]);
    return { id: pid, executionResult: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bajarilmadi";
    await pool.query(`UPDATE ai_assistant_proposals SET status='failed', execution_result=$2 WHERE id=$1`, [pid, msg]);
    return { id: pid, error: msg };
  }
}

/** Jonli holat: profil + filial + bugungi davomat + atestatsiya + javob olish */
export async function buildUserSnapshot(user: PlatformUser): Promise<string> {
  const parts: string[] = [
    `Xodim: ${user.fullName} (id=${user.id}, rol=${user.role}, login=${user.login}, holat=${user.status}${user.phone ? `, tel=${user.phone}` : ""})`,
  ];
  try {
    const branches = await resolveUserBranches([user.id]);
    const b = branches.get(user.id);
    if (b?.label) parts.push(`Filiali: ${b.label}`);
  } catch { /* ignore */ }

  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, user.id))
      .limit(1);
    const recs = await db
      .select()
      .from(attendanceRecordsTable)
      .where(
        or(
          eq(attendanceRecordsTable.userId, user.id),
          emp ? eq(attendanceRecordsTable.employeeId, emp.id) : sql`false`,
        ),
      )
      .orderBy(desc(attendanceRecordsTable.workDate))
      .limit(5);
    if (recs.length) {
      const fmtTime = new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Asia/Tashkent",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      parts.push(
        "Davomat (oxirgi, vaqtlar Toshkent): " +
          recs
            .map(
              (r) =>
                `${r.workDate}: keldim=${r.checkInAt ? fmtTime.format(new Date(r.checkInAt)) : "—"}, ketdim=${r.checkOutAt ? fmtTime.format(new Date(r.checkOutAt)) : "—"}, holat=${r.status}${r.excused ? " (sababli)" : ""}`,
            )
            .join("; "),
      );
    } else {
      parts.push(`Davomat: oxirgi yozuvlar topilmadi (bugun ${today}).`);
    }
  } catch { /* ignore */ }

  try {
    const attempts = await db
      .select({
        status: attestatsiyaAttemptsTable.status,
        score: attestatsiyaAttemptsTable.score,
        passed: attestatsiyaAttemptsTable.passed,
        startedAt: attestatsiyaAttemptsTable.startedAt,
        title: attestatsiyaExamsTable.title,
        examId: attestatsiyaExamsTable.id,
        endsAt: attestatsiyaExamsTable.endsAt,
      })
      .from(attestatsiyaAttemptsTable)
      .innerJoin(attestatsiyaExamsTable, eq(attestatsiyaAttemptsTable.examId, attestatsiyaExamsTable.id))
      .where(eq(attestatsiyaAttemptsTable.userId, user.id))
      .orderBy(desc(attestatsiyaAttemptsTable.startedAt))
      .limit(5);
    if (attempts.length) {
      parts.push(
        "Atestatsiya urinishlari: " +
          attempts
            .map((a) => `«${a.title}» (examId=${a.examId}) ${a.status}, ball=${a.score ?? "—"}, o'tdi=${a.passed ?? "—"}`)
            .join("; "),
      );
    }
  } catch { /* ignore */ }

  // Atestatsiya JADVALI (real vaqt) — sana/vaqt faqat shu yerdan olinadi
  try {
    const track = (["stajyor", "farmasevt", "mudir"] as const).find((t) => t === user.role);
    const fmt = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const now = new Date();
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(now);
    parts.push(`Hozir (Toshkent): ${fmt.format(now)}, sana ${todayStr}`);
    if (track) {
      const roleJson = JSON.stringify([track]);
      const exams = await db
        .select()
        .from(attestatsiyaExamsTable)
        .where(
          and(
            eq(attestatsiyaExamsTable.published, true),
            or(
              and(
                sql`COALESCE(jsonb_array_length(${attestatsiyaExamsTable.targetTracks}), 0) = 0`,
                eq(attestatsiyaExamsTable.track, track),
              ),
              sql`${attestatsiyaExamsTable.targetTracks} @> ${roleJson}::jsonb`,
              eq(attestatsiyaExamsTable.track, track),
            ),
          ),
        )
        .orderBy(attestatsiyaExamsTable.startsAt);
      const myAttempts = await db
        .select()
        .from(attestatsiyaAttemptsTable)
        .where(eq(attestatsiyaAttemptsTable.userId, user.id));
      const latestByExam = new Map<number, (typeof myAttempts)[number]>();
      for (const a of myAttempts) latestByExam.set(a.examId, a);
      const relevant = exams
        .filter((e) => e.endsAt.getTime() > now.getTime() - 24 * 3600_000)
        .slice(0, 10);
      if (!relevant.length) {
        parts.push(
          "Atestatsiya jadvali: BAZADA BU XODIMGA TEGISHLI E'LON QILINGAN TEST YO‘Q. Hech qanday sana/vaqt aytma — «bazada rejalashtirilgan test ko‘rinmayapti» deb ayt.",
        );
      } else {
        parts.push(
          "Atestatsiya jadvali (bazadan, real): " +
            relevant
              .map((e) => {
                const state = now < e.startsAt ? "hali boshlanmagan" : now >= e.endsAt ? "yopilgan" : "HOZIR OCHIQ";
                const mine = latestByExam.get(e.id);
                const mineTxt = mine
                  ? `, mening holatim: ${mine.status}${mine.passed != null ? `, o'tdi=${mine.passed}` : ""}`
                  : ", hali boshlamaganman";
                return `«${e.title}» (examId=${e.id}) ${fmt.format(e.startsAt)} – ${fmt.format(e.endsAt)}, ${e.durationMinutes} daq, holat=${state}${mineTxt}`;
              })
              .join("; "),
        );
        const todayExams = relevant.filter(
          (e) =>
            new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(e.startsAt) === todayStr,
        );
        parts.push(
          todayExams.length
            ? `Bugunga rejalashtirilgan: ${todayExams.map((e) => `«${e.title}» ${fmt.format(e.startsAt)}`).join(", ")}`
            : "Bugunga rejalashtirilgan test YO‘Q (yuqoridagi jadvalda eng yaqini ko‘rsatilgan).",
        );
      }
    }
  } catch { /* ignore */ }

  try {
    const reqs = await db
      .select()
      .from(javobOlishRequestsTable)
      .where(eq(javobOlishRequestsTable.userId, user.id))
      .orderBy(desc(javobOlishRequestsTable.createdAt))
      .limit(3);
    if (reqs.length) {
      parts.push(
        "Javob olish: " +
          reqs.map((r) => `${r.workDate} ${r.fromHm}–${r.toHm} holat=${r.status}`).join("; "),
      );
    }
  } catch { /* ignore */ }

  return parts.join("\n");
}

/* ---------------------------------------------------------------------- AI */

const AI_MODEL =
  process.env.OPENAI_AI_MODEL?.trim() || process.env.OPENAI_HELP_MODEL?.trim() || "gpt-4o-mini";

export function aiAssistantEnabled(): boolean {
  return process.env.AI_ASSISTANT_ENABLED !== "0" && Boolean(process.env.OPENAI_API_KEY?.trim());
}

async function callAi(opts: {
  snapshot: string | null;
  history: Array<{ role: string; text: string }>;
  userText: string;
  displayName: string;
  /** true — suhbatdosh admin (egasi): amal darhol bajariladi */
  adminMode?: boolean;
}): Promise<AiTurnResult | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const kb = loadPlatformHelpKnowledge().slice(0, 45_000);
  const historyText = opts.history
    .slice(-12)
    .map((m) => `${m.role === "user" ? "Xodim" : "Yordamchi"}: ${m.text}`)
    .join("\n");

  const system = [
    "Sen VAKSINA MED HR platformasi adminining yordamchisisan. Telegramda xodimlar bilan jonli, iliq, odamdek suhbatlashasan: har bir odamga vaziyatiga qarab alohida yondash, bir xil shablon gapirma.",
    "TIL: Xodim qaysi tilda va qaysi yozuvda yozsa (o‘zbek lotin, o‘zbek kirill, rus, ingliz), javobni AYNAN o‘sha tilda/yozuvda yoz.",
    "O‘zingni bot deb tanishtirma. Lekin to‘g‘ridan-to‘g‘ri «siz botmisiz / robotmisiz / odammisiz?» deb so‘ralsa, rostini ayt: admin jamoasining AI yordamchisiman, admin nazoratida ishlayman.",
    "PAROL so‘rama va qabul qilma. Login kerak bo‘lsa faqat loginni (parolsiz) so‘ra.",
    opts.adminMode
      ? "ADMIN REJIMI: suhbatdosh — platformaning egasi (admin), u botning yagona boshqaruvchisi. Nima desa — shuni to‘liq bajar: kimnidir yozib ma’lumot so‘rasa, JONLI BAZADAN to‘liq va aniq javob ber. Biror amal buyursa (testni qayta och, davomatni tuzat, xodimga xabar yubor) va ma’lumot yetarli bo‘lsa — proposal maydoniga amalni yoz, u DARHOL bajariladi (tasdiq kutilmaydi). reply da faqat qisqa izoh yoz («tekshirdim», nima topding) — «bajarildi» qismini tizim natija bilan qo‘shadi. Ma’lumot yetishmasa yoki xodim aniq topilmasa — proposal YARATMA, aniqlashtiruvchi savol ber."
      : "XODIM REJIMI (QAT’IY): sen FAQAT standart so‘rovlarga javob berasan: (1) o‘z davomati — qachon keldim/ketdim, qaysi kuni kelgan-kelmagani; (2) o‘z testlari — ball, o‘tgan/o‘tmagani, jadvali; (3) javob olish so‘rovi holati; (4) platforma qanday ishlatiladi (bilim bazasidan qisqa ko‘rsatma). Boshqa hech narsa QILMA: erkin suhbat/chat, vazifa qabul qilish, ma’lumot o‘zgartirish yoki biror ishni bajarishni va’da qilish TAQIQLANGAN. proposal va file HAR DOIM null bo‘lsin. O‘zgartirish/amal so‘ralsa yoki mavzudan tashqari gap bo‘lsa — xodim yozgan tilda bitta qisqa javob ber: bu ishlarni faqat admin bajaradi, admin bilan bog‘laning; o‘zing esa faqat davomat/test/platforma bo‘yicha standart ma’lumot bera olasan. Boshqa odamlar haqida ma’lumot BERMA.",
    opts.adminMode
      ? "FAYL BUYRUG‘I: admin «PDF qilib ber», «Excel qilib ber», «ro‘yxatni fayl qilib yubor» desa — file maydonini to‘ldir va reply da qisqa «Tayyorlayapman» deb yoz (faylni tizim o‘zi yuboradi, «yubordim» deb o‘zing yozma). Tayyor bazaviy datasetlar: employees (barcha xodimlar ro‘yxati), davomat_today (bugungi), davomat_week (oxirgi 7 kun — «1 haftalik» desa shu), davomat_month (oy boshidan), atestatsiya_results. Admin bir xodimni yozib o‘shaning davomati/testini fayl so‘rasa — odamni QIDIRMA va aniqlashtirish SO‘RAMA: tizim odamni o‘zi topgan va snapshot aynan o‘sha odam haqida; shunchaki mos datasetni tanla, fayl tizim tomonidan o‘sha xodim bo‘yicha filtrlanadi. Admin aynan snapshotdagi jadvalni fayl qilishni so‘rasa — dataset=custom_table qilib columns va rows ni O‘ZING to‘ldir (faqat bazada/suhbatda aniq ko‘ringan faktlar bilan, uydirma qo‘shma)."
      : "",
    "Noqonuniy/for qalbakilashtirish so‘ralsa (masalan kelmagan kunga davomat yozib berish): rad et, sababini odamdek tushuntir va qonuniy yo‘lni ayt (javob olish so‘rovi, koordinatordan tasdiq). Bunday so‘rov uchun taklif YARATMA.",
    opts.adminMode
      ? "Ma’lumot yetishmasa bitta-ikkita aniq savol ber: ism-familiya, filial, sana/vaqt, qanday xato chiqyapti. Hamma ma’lumot yig‘ilgach va admin aniq amal so‘ragach — proposal yarat."
      : "Standart so‘rovga ma’lumot yetishmasa (masalan qaysi sana nazarda tutilgani) — bitta aniq savol ber. Amal so‘roviga esa savol berma — darhol standart rad javobini ber.",
    "Savol faqat ma’lumot so‘rasa (test qayerdan, qanday ishlanadi, smena, kirish...): bazadagi faktlar + jonli holat asosida to‘liq javob ber, proposal kerak emas.",
    "FAKT QOIDASI (eng muhim): sana, vaqt, ball, holat, filial, test nomi kabi aniq ma’lumotni FAQAT «JONLI BAZA HOLATI»da yozilganidan ol. U yerda yo‘q bo‘lsa — HECH QACHON uydirma (masalan «soat 10:00 da test bor» deb aytma). Buning o‘rniga: «Bazada hozir bunday ma’lumot ko‘rinmayapti, adminga aniqlashtirib beraman» deb ayt. «Jadvalda YO‘Q» deb yozilgan bo‘lsa — test yo‘qligini aniq ayt.",
    "Javob uzunligi: odatda 2–6 jumla, ro‘yxat kerak bo‘lsa qisqa ro‘yxat. Ortiqcha rasmiyatchilik qilma.",
    "",
    'Faqat JSON qaytar: {"reply":"...","intent":"davomat|atestatsiya|login|javob|smena|savol|boshqa","proposal":null yoki {"kind":"davomat_fix|atestatsiya_retake|account_help|admin_task|notify_user","title":"qisqa sarlavha","summary":"kim, nima, sabab, tekshirilgan faktlar","payload":{"userId":123,"workDate":"2026-10-20","examId":1,"message":"xodimga matn","note":"..."},"completionText":"amal bajarilgach xodimga yuboriladigan yakuniy xabar"},"file":null yoki {"format":"pdf"|"excel","dataset":"employees"|"davomat_today"|"davomat_week"|"davomat_month"|"atestatsiya_results"|"custom_table","title":"fayl sarlavhasi","columns":["ustun"],"rows":[["qiymat"]]}. file FAQAT admin rejimida va faqat admin fayl so‘raganda to‘ldiriladi; xodim rejimida file DOIM null.',
    "davomat_fix payload da iloji bo‘lsa workDate va tuzatiladigan vaqtlarni yoz. atestatsiya_retake da examId ni yoz (bilinmasa summary da test nomini yoz). notify_user da payload.message — xodimga yuboriladigan matn.",
    "",
    opts.snapshot ? `=== JONLI BAZA HOLATI ===\n${opts.snapshot}` : "=== JONLI BAZA: xodim hali aniqlanmadi (ism-familiya/filial so‘ra) ===",
    "",
    "=== PLATFORMA BILIM BAZASI ===",
    kb,
  ].join("\n");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.45,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Suhbat tarixi:\n${historyText || "(yangi suhbat)"}\n\nXodim (${opts.displayName}) yozdi:\n${opts.userText}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "ai-assistant: openai http");
      return null;
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}") as Record<string, unknown>;
    const reply = String(parsed.reply || "").trim();
    if (!reply) return null;
    let proposal: AiTurnResult["proposal"] = null;
    const p = parsed.proposal as Record<string, unknown> | null;
    if (p && typeof p === "object" && p.title && p.summary) {
      const kinds: AiProposalKind[] = ["davomat_fix", "atestatsiya_retake", "account_help", "admin_task", "notify_user"];
      const kind = kinds.includes(p.kind as AiProposalKind) ? (p.kind as AiProposalKind) : "admin_task";
      proposal = {
        kind,
        title: String(p.title).slice(0, 200),
        summary: String(p.summary).slice(0, 4000),
        payload: (p.payload && typeof p.payload === "object" ? p.payload : {}) as Record<string, unknown>,
        completionText: p.completionText ? String(p.completionText).slice(0, 1000) : undefined,
      };
    }
    // Fayl so'rovi — FAQAT admin rejimida qabul qilinadi (xodimlarda kod darajasida kesiladi)
    let file: AssistantFileRequest | null = null;
    const f = parsed.file as Record<string, unknown> | null;
    if (opts.adminMode && f && typeof f === "object") {
      const formats = ["pdf", "excel"];
      const datasets = ["employees", "davomat_today", "davomat_week", "davomat_month", "atestatsiya_results", "custom_table"];
      const format = formats.includes(String(f.format)) ? (String(f.format) as "pdf" | "excel") : "excel";
      const dataset = datasets.includes(String(f.dataset))
        ? (String(f.dataset) as AssistantFileRequest["dataset"])
        : "custom_table";
      file = {
        format,
        dataset,
        title: f.title ? String(f.title).slice(0, 120) : undefined,
        columns: Array.isArray(f.columns) ? f.columns.map((c) => String(c)) : undefined,
        rows: Array.isArray(f.rows)
          ? (f.rows as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []))
          : undefined,
      };
    }
    return { reply: reply.slice(0, 3000), intent: String(parsed.intent || "boshqa").slice(0, 40), proposal, file };
  } catch (err) {
    logger.warn({ err }, "ai-assistant: openai failed");
    return null;
  }
}

/* ------------------------------------------------- xodim: AI-siz standart javob */

/**
 * XODIMLARGA AI (OpenAI) UMUMAN ISHLATILMAYDI.
 * Javob faqat jonli bazadan, kod bilan tayyorlanadi: davomat (kirdi-chiqdi),
 * test holati/jadvali, javob olish holati. Boshqa gapga — standart menyu.
 * AI «o'ylash» faqat admin yozganda ishlatiladi.
 */
type StdLoc = "latn" | "cyrl" | "ru";

function detectStdLoc(text: string): StdLoc {
  if (!CYRILLIC_RE.test(text)) return "latn";
  if (/[ўқғҳЎҚҒҲ]/.test(text)) return "cyrl";
  if (
    /(когда|во сколько|приш[её]л|пришла|уш[её]л|ушла|опозд|результат|здравств|привет|пожалуйста|посеща|мой|моя|можно|сегодня)/i.test(
      text,
    )
  )
    return "ru";
  return "cyrl";
}

const STD_TEXT = {
  latn: {
    askId: (n: string) =>
      `Salom${n ? `, ${n}` : ""}! Avval ism-familiyangiz va filialingizni yozing — keyin «davomatim» yoki «testim» deb yozsangiz, ma’lumot beraman.`,
    menu: (n: string) =>
      `Salom, ${n}! Men faqat standart ma’lumot bera olaman:\n• «Davomatim» — qachon kelgan/ketganingiz\n• «Testim» — test natijasi va jadvali\n• «Javob olish» — so‘rovingiz holati\nShulardan birini yozing. Biror o‘zgartirish kerak bo‘lsa — faqat admin bajaradi, admin bilan bog‘laning.`,
    davomat: "📋 Davomatingiz (oxirgi kunlar):",
    noDavomat: "📋 Davomat yozuvlari topilmadi.",
    came: "keldi",
    went: "ketdi",
    tests: "📝 Testlaringiz:",
    attempts: "Urinishlar:",
    schedule: "Jadval:",
    ball: "ball",
    passed: "o‘tdi",
    failed: "o‘tmadi",
    open: "hozir ochiq",
    upcoming: "hali boshlanmagan",
    closed: "yopilgan",
    noTests: "📝 Test ma’lumoti topilmadi.",
    javob: "📌 Javob olish so‘rovlari:",
    noJavob: "📌 Javob olish so‘rovi topilmadi.",
  },
  cyrl: {
    askId: (n: string) =>
      `Салом${n ? `, ${n}` : ""}! Аввал исм-фамилиянгиз ва филиалингизни ёзинг — кейин «давоматим» ёки «тестим» деб ёзсангиз, маълумот бераман.`,
    menu: (n: string) =>
      `Салом, ${n}! Мен фақат стандарт маълумот бера оламан:\n• «Давоматим» — қачон келган/кетганингиз\n• «Тестим» — тест натижаси ва жадвали\n• «Жавоб олиш» — сўровингиз ҳолати\nШулардан бирини ёзинг. Бирор ўзгартириш керак бўлса — фақат админ бажаради, админ билан боғланинг.`,
    davomat: "📋 Давоматингиз (охирги кунлар):",
    noDavomat: "📋 Давомат ёзувлари топилмади.",
    came: "келди",
    went: "кетди",
    tests: "📝 Тестларингиз:",
    attempts: "Уринишлар:",
    schedule: "Жадвал:",
    ball: "балл",
    passed: "ўтди",
    failed: "ўтмади",
    open: "ҳозир очиқ",
    upcoming: "ҳали бошланмаган",
    closed: "ёпилган",
    noTests: "📝 Тест маълумоти топилмади.",
    javob: "📌 Жавоб олиш сўровлари:",
    noJavob: "📌 Жавоб олиш сўрови топилмади.",
  },
  ru: {
    askId: (n: string) =>
      `Здравствуйте${n ? `, ${n}` : ""}! Сначала напишите имя, фамилию и филиал — затем напишите «посещаемость» или «тест», и я дам информацию.`,
    menu: (n: string) =>
      `Здравствуйте, ${n}! Я могу дать только стандартную информацию:\n• «Посещаемость» — когда вы пришли/ушли\n• «Тест» — результат и расписание теста\n• «Отпрос» — статус вашего запроса\nНапишите одно из этих слов. Если нужно что-то изменить — это делает только админ, свяжитесь с админом.`,
    davomat: "📋 Ваша посещаемость (последние дни):",
    noDavomat: "📋 Записи посещаемости не найдены.",
    came: "приход",
    went: "уход",
    tests: "📝 Ваши тесты:",
    attempts: "Попытки:",
    schedule: "Расписание:",
    ball: "балл",
    passed: "сдал",
    failed: "не сдал",
    open: "сейчас открыт",
    upcoming: "ещё не начался",
    closed: "закрыт",
    noTests: "📝 Информация о тестах не найдена.",
    javob: "📌 Запросы на отпрос:",
    noJavob: "📌 Запросы на отпрос не найдены.",
  },
} as const;

async function employeeStandardReply(
  user: PlatformUser | null,
  userText: string,
  displayName: string,
): Promise<AiTurnResult> {
  const loc = detectStdLoc(userText);
  const L = STD_TEXT[loc];
  if (!user) {
    return { reply: L.askId(displayName), intent: "identity", proposal: null, file: null };
  }
  const t = userText.toLowerCase();
  const isDavomat =
    /davomat|keldim|ketdim|kelgan|kelmad|kechik|kirdi|chiqdi|давомат|келдим|кетдим|келган|келма|кечик|приш|пришел|пришла|уш[её]л|ушла|опозд|во сколько|посеща/.test(t);
  const isTest = /test|attest|atest|ball|imtihon|тест|аттеста|балл|натиж|экзамен|результат/.test(t);
  const isJavob = /javob|ruxsat|жавоб|жавоп|отпрос|отгул/.test(t);

  if (!isDavomat && !isTest && !isJavob) {
    return { reply: L.menu(user.fullName), intent: "savol", proposal: null, file: null };
  }

  const fmtTime = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
  const fmtDay = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
  });
  const sections: string[] = [];

  if (isDavomat) {
    try {
      const [emp] = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(eq(employeesTable.userId, user.id))
        .limit(1);
      const recs = await db
        .select()
        .from(attendanceRecordsTable)
        .where(
          or(
            eq(attendanceRecordsTable.userId, user.id),
            emp ? eq(attendanceRecordsTable.employeeId, emp.id) : sql`false`,
          ),
        )
        .orderBy(desc(attendanceRecordsTable.workDate))
        .limit(5);
      if (!recs.length) {
        sections.push(L.noDavomat);
      } else {
        const lines = recs.map(
          (r) =>
            `• ${r.workDate}: ${L.came} ${r.checkInAt ? fmtTime.format(new Date(r.checkInAt)) : "—"}, ${L.went} ${r.checkOutAt ? fmtTime.format(new Date(r.checkOutAt)) : "—"} (${r.status})`,
        );
        sections.push([L.davomat, ...lines].join("\n"));
      }
    } catch {
      sections.push(L.noDavomat);
    }
  }

  if (isTest) {
    try {
      const attempts = await db
        .select({
          status: attestatsiyaAttemptsTable.status,
          score: attestatsiyaAttemptsTable.score,
          passed: attestatsiyaAttemptsTable.passed,
          startedAt: attestatsiyaAttemptsTable.startedAt,
          title: attestatsiyaExamsTable.title,
        })
        .from(attestatsiyaAttemptsTable)
        .innerJoin(attestatsiyaExamsTable, eq(attestatsiyaAttemptsTable.examId, attestatsiyaExamsTable.id))
        .where(eq(attestatsiyaAttemptsTable.userId, user.id))
        .orderBy(desc(attestatsiyaAttemptsTable.startedAt))
        .limit(5);
      const track = (["stajyor", "farmasevt", "mudir"] as const).find((x) => x === user.role);
      const now = new Date();
      let scheduleLines: string[] = [];
      if (track) {
        const roleJson = JSON.stringify([track]);
        const exams = await db
          .select()
          .from(attestatsiyaExamsTable)
          .where(
            and(
              eq(attestatsiyaExamsTable.published, true),
              or(
                and(
                  sql`COALESCE(jsonb_array_length(${attestatsiyaExamsTable.targetTracks}), 0) = 0`,
                  eq(attestatsiyaExamsTable.track, track),
                ),
                sql`${attestatsiyaExamsTable.targetTracks} @> ${roleJson}::jsonb`,
                eq(attestatsiyaExamsTable.track, track),
              ),
            ),
          )
          .orderBy(attestatsiyaExamsTable.startsAt);
        scheduleLines = exams
          .filter((e) => e.endsAt.getTime() > now.getTime() - 24 * 3600_000)
          .slice(0, 5)
          .map((e) => {
            const state = now < e.startsAt ? L.upcoming : now >= e.endsAt ? L.closed : L.open;
            return `• «${e.title}» — ${fmtDay.format(e.startsAt)} ${fmtTime.format(e.startsAt)}–${fmtTime.format(e.endsAt)} (${state})`;
          });
      }
      if (!attempts.length && !scheduleLines.length) {
        sections.push(L.noTests);
      } else {
        const parts = [L.tests];
        if (attempts.length) {
          parts.push(L.attempts);
          for (const a of attempts) {
            parts.push(
              `• «${a.title}» — ${L.ball}: ${a.score ?? "—"}, ${a.passed == null ? a.status : a.passed ? L.passed : L.failed}`,
            );
          }
        }
        if (scheduleLines.length) {
          parts.push(L.schedule, ...scheduleLines);
        }
        sections.push(parts.join("\n"));
      }
    } catch {
      sections.push(L.noTests);
    }
  }

  if (isJavob) {
    try {
      const reqs = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(eq(javobOlishRequestsTable.userId, user.id))
        .orderBy(desc(javobOlishRequestsTable.createdAt))
        .limit(3);
      if (!reqs.length) {
        sections.push(L.noJavob);
      } else {
        sections.push(
          [L.javob, ...reqs.map((r) => `• ${r.workDate} ${r.fromHm}–${r.toHm} — ${r.status}`)].join("\n"),
        );
      }
    } catch {
      sections.push(L.noJavob);
    }
  }

  const intent = isDavomat ? "davomat" : isTest ? "atestatsiya" : "javob";
  return { reply: sections.join("\n\n"), intent, proposal: null, file: null };
}

/* ------------------------------------------------------------- suhbat oqimi */

async function getOrCreateConversation(msg: TelegramMessage, businessConnectionId?: string | null): Promise<ConvRow> {
  await ensureAiAssistantSchema();
  const tgUserId = String(msg.from!.id);
  const chatId = String(msg.chat.id);
  const { rows } = await pool.query<ConvRow>(
    `SELECT * FROM ai_assistant_conversations
     WHERE telegram_user_id = $1 AND telegram_chat_id = $2
     ORDER BY id DESC LIMIT 1`,
    [tgUserId, chatId],
  );
  const name = senderDisplayName(msg);
  if (rows[0]) {
    await pool.query(
      `UPDATE ai_assistant_conversations
       SET updated_at = NOW(), display_name = $2, username = $3,
           business_connection_id = COALESCE($4, business_connection_id)
       WHERE id = $1`,
      [rows[0].id, name, msg.from?.username || null, businessConnectionId || null],
    );
    return rows[0];
  }
  const ins = await pool.query<ConvRow>(
    `INSERT INTO ai_assistant_conversations
       (telegram_user_id, telegram_chat_id, business_connection_id, chat_type, display_name, username)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tgUserId, chatId, businessConnectionId || null, msg.chat.type, name, msg.from?.username || null],
  );
  return ins.rows[0]!;
}

async function saveMessage(conversationId: number, role: string, text: string) {
  await pool.query(`INSERT INTO ai_assistant_messages (conversation_id, role, text) VALUES ($1,$2,$3)`, [
    conversationId,
    role,
    text.slice(0, 6000),
  ]);
}

async function loadHistory(conversationId: number): Promise<Array<{ role: string; text: string }>> {
  const { rows } = await pool.query<{ role: string; text: string }>(
    `SELECT role, text FROM ai_assistant_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 14`,
    [conversationId],
  );
  return rows.reverse();
}

async function notifyAdminsAboutProposal(proposalId: number, conv: ConvRow, p: NonNullable<AiTurnResult["proposal"]>) {
  try {
    const { notifyByRoles } = await import("./notify");
    await notifyByRoles({
      roles: ["admin"],
      title: "Yordamchi AI",
      text: `Yangi taklif #${proposalId}: ${p.title} — ${conv.display_name || "xodim"}. Tasdiqlash: Yordamchi AI bo‘limi.`,
      type: "ai_assistant",
      linkUrl: "/admin/yordamchi-ai",
    });
  } catch { /* ignore */ }
}

/**
 * Telegram xabarini AI yordamchi orqali qayta ishlash.
 * true — javob yuborildi (chaqiruvchi boshqa handlerga o‘tmaydi).
 */
export async function handleAiAssistantMessage(
  msg: TelegramMessage,
  opts?: { businessConnectionId?: string | null },
): Promise<boolean> {
  if (!msg.from || msg.from.is_bot) return false;
  // Guruhda adminga javob berilmaydi (xavfsizlik to‘ri — asosiy darvoza routes/telegram.ts da)
  if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
    const adminTg = await isAiAdminTelegramId(String(msg.from.id)).catch(() => false);
    if (adminTg) return true;
    const linked = await findUserByTelegram(String(msg.from.id)).catch(() => null);
    if (linked?.role === "admin") return true;
  }
  const chatId = msg.chat.id;
  const businessConnectionId = opts?.businessConnectionId || msg.business_connection_id || null;
  const sendOpts = businessConnectionId ? { business_connection_id: businessConnectionId } : undefined;

  // Ovoz / video xabar — matn so‘raymiz
  if (msg.voice || msg.video_note || msg.audio) {
    const conv = await getOrCreateConversation(msg, businessConnectionId).catch(() => null);
    const text =
      "Ovozli xabarni hozircha eshitolmayman 🙂 Iltimos, muammoni yozib yuboring — o‘qib, darhol ko‘rib chiqaman.";
    if (conv) {
      await saveMessage(conv.id, "user", "[ovozli xabar]").catch(() => {});
      await saveMessage(conv.id, "assistant", text).catch(() => {});
    }
    await sendMessage(chatId, text, sendOpts).catch(() => {});
    return true;
  }

  const text = (msg.text ?? msg.caption ?? "").trim();
  if (!text || text.startsWith("/")) return false;

  // --- Ruxsat darvozasi: begonalar botni ishlatolmaydi ---
  const isBusiness = Boolean(businessConnectionId);
  if (isBusiness) {
    const ok = await businessConnectionAllowed(businessConnectionId!).catch(() => false);
    if (!ok) {
      logger.warn({ businessConnectionId }, "ai-assistant: begona business ulanish rad etildi");
      return true; // jim qolamiz — begona akkauntga javob bermaymiz
    }
  } else {
    const linked = await findUserByTelegram(String(msg.from.id)).catch(() => null);
    const isAdmin = await isAiAdminTelegramId(String(msg.from.id)).catch(() => false);
    if (!linked && !isAdmin) {
      await sendMessage(
        chatId,
        "Salom 🙂 Davom etish uchun avval akkauntingizni bog‘lang: /start bosing va login/parolingizni yuboring. Bog‘langach muammoingizni yozsangiz, ko‘rib chiqaman.",
        sendOpts,
      ).catch(() => {});
      return true;
    }
  }

  const conv = await getOrCreateConversation(msg, businessConnectionId);
  await saveMessage(conv.id, "user", text);

  // Parol yuborilgan bo‘lsa — ogohlantirish (saqlamaymiz deb aytamiz)
  if (PASSWORD_HINT_RE.test(text) && /parol|пароль|password/i.test(text)) {
    const warn =
      "Xavfsizlik uchun parolingizni bu yerga yozmang 🙂 Parol kerak emas — ism-familiyangiz va muammoni yozsangiz kifoya, o‘zim tekshirib chiqaman.";
    await saveMessage(conv.id, "assistant", warn);
    await sendMessage(chatId, warn, sendOpts).catch(() => {});
    return true;
  }

  const history = await loadHistory(conv.id);
  const linkedSelf = await findUserByTelegram(String(msg.from.id)).catch(() => null);
  const convUser = conv.platform_user_id
    ? await db
        .select({
          id: usersTable.id,
          fullName: usersTable.fullName,
          role: usersTable.role,
          login: usersTable.login,
          phone: usersTable.phone,
          status: usersTable.status,
          telegramId: usersTable.telegramId,
        })
        .from(usersTable)
        .where(eq(usersTable.id, conv.platform_user_id))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;
  const self = linkedSelf ?? convUser;

  // Admin buyrug‘i rejimi: faqat egasi (admin) — yozgan odamini topib, amalni darhol bajaradi
  const isAdminSender =
    (await isAiAdminTelegramId(String(msg.from.id)).catch(() => false)) || self?.role === "admin";

  if (isAdminSender) {
    const userTexts = [text, ...history.filter((h) => h.role === "user").map((h) => h.text).reverse()];
    const { user: target, candidates } = await resolveTargetFromTexts(userTexts).catch(() => ({
      user: null,
      candidates: [] as PlatformUser[],
    }));
    if (!target && candidates.length > 1) {
      const list = candidates
        .map((c, i) => `${i + 1}. ${c.fullName} — ${c.role}, login: ${c.login}`)
        .join("\n");
      const ask = `Bir nechta xodim topildi, qaysi birini nazarda tutyapsiz?\n${list}\nTo‘liq ism yoki loginini yozing.`;
      await saveMessage(conv.id, "assistant", ask);
      await sendMessage(chatId, ask, sendOpts).catch(() => {});
      return true;
    }
    const effective = target ?? self;
    const snapshot = effective
      ? `REJIM: ADMIN BUYRUG‘I (suhbatdosh — admin, nishon — ${effective.fullName}). Admin aytsa amal darhol bajariladi.\n` +
        (await buildUserSnapshot(effective).catch(() => ""))
      : null;
    const turn = aiAssistantEnabled()
      ? await callAi({ snapshot, history, userText: text, displayName: senderDisplayName(msg), adminMode: true })
      : null;
    const result =
      turn ?? {
        reply: target
          ? `${target.fullName} bo‘yicha ma’lumot tayyor. Qaysi amal kerakligini aniq yozing (masalan: testni qayta och, davomatni tuzat, xabar yubor).`
          : "Tushunmadim — kim haqida va nima qilish kerakligini aniqroq yozing (ism-familiya + amal).",
        intent: "admin",
        proposal: null,
      };
    let reply = result.reply;
    if (result.proposal && effective) {
      const rec = await recordProposal(conv, effective.id, result.proposal, "executed", self?.id ?? null);
      if (rec.executionResult) {
        reply = `${reply}\n\n✅ Bajarildi: ${rec.executionResult}`;
        if (result.proposal.completionText && target && self && target.id !== self.id) {
          const { notifyUser } = await import("./notify");
          await notifyUser({
            userId: target.id,
            title: "Yordamchi AI",
            text: result.proposal.completionText,
            type: "ai_assistant",
            linkUrl: "/dashboard",
          }).catch(() => undefined);
        }
      } else if (rec.error) {
        reply = `${reply}\n\n⚠️ Bajarilmadi: ${rec.error}. Ma’lumotni aniqlashtirib qayta yozing.`;
      }
    }
    // Admin fayl so'ragan bo'lsa (PDF/Excel) — jonli bazadan tayyorlab, shu chatga yuboramiz
    if (result.file) {
      try {
        const { buildAssistantFile } = await import("./ai-assistant-files");
        const built = await buildAssistantFile(
          result.file,
          target ? { userId: target.id, userName: target.fullName } : undefined,
        );
        await sendDocument(chatId, built.buffer, built.filename, {
          mimeType: built.mime,
          caption: `📊 ${built.title} · ${built.rowCount} qator`,
          businessConnectionId: businessConnectionId || undefined,
        });
        reply = `${reply}\n\n📎 Fayl yuborildi: ${built.filename} (${built.rowCount} qator)`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "noma'lum xato";
        logger.warn({ err }, "ai-assistant admin file failed");
        reply = `${reply}\n\n⚠️ Fayl tayyorlanmadi: ${msg}. Qaysi ma’lumot kerakligini aniqroq yozing.`;
      }
    }
    await saveMessage(conv.id, "assistant", reply);
    await pool.query(`UPDATE ai_assistant_conversations SET intent = $2, updated_at = NOW() WHERE id = $1`, [
      conv.id,
      result.intent,
    ]);
    await sendMessage(chatId, reply, sendOpts).catch((err) => logger.warn({ err }, "ai-assistant admin send failed"));
    return true;
  }

  // Ism bo‘yicha aniqlash FAQAT admin akkaunti (Business) chatlarida —
  // botning shaxsiy chatida shaxs telegram_id bog‘lanishi bilan tasdiqlanadi.
  const mentioned = isBusiness
    ? self ?? (await extractMentionedUser(history.map((h) => h.text).join("\n"), null).catch(() => null))
    : self;
  const platformUser = mentioned;

  if (platformUser && conv.platform_user_id !== platformUser.id) {
    await pool.query(`UPDATE ai_assistant_conversations SET platform_user_id = $2, updated_at = NOW() WHERE id = $1`, [
      conv.id,
      platformUser.id,
    ]);
  }

  // Xodim: AI umuman ishlatilmaydi — faqat bazadan tayyor standart javob
  const result = await employeeStandardReply(platformUser, text, senderDisplayName(msg));

  await saveMessage(conv.id, "assistant", result.reply);
  await pool.query(`UPDATE ai_assistant_conversations SET intent = $2, updated_at = NOW() WHERE id = $1`, [
    conv.id,
    result.intent,
  ]);

  // Xodim rejimi: taklif/amal yaratilmaydi — yozish va bajarish faqat adminda.
  // Xodim faqat standart ma'lumot oladi (davomat, test, platforma ko'rsatmasi).

  await sendMessage(chatId, result.reply, sendOpts).catch((err) => {
    logger.warn({ err }, "ai-assistant: sendMessage failed");
  });
  return true;
}

/**
 * Platforma ichidagi chat (login qilgan foydalanuvchi): Telegram oqimi bilan bir xil —
 * xodimga faqat standart ma'lumot, adminga to'liq boshqaruv + fayl (PDF/Excel).
 */
export async function webAssistantTurn(opts: {
  userId: number;
  history: Array<{ role: string; text: string }>;
  userText: string;
}): Promise<AiTurnResult> {
  await ensureAiAssistantSchema();
  const [u] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      login: usersTable.login,
      phone: usersTable.phone,
      status: usersTable.status,
      telegramId: usersTable.telegramId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, opts.userId))
    .limit(1);
  const platformUser: PlatformUser | null = u ?? null;

  const tgKey = `web:${opts.userId}`;
  const { rows } = await pool.query<ConvRow>(
    `SELECT * FROM ai_assistant_conversations WHERE telegram_user_id = $1 ORDER BY id DESC LIMIT 1`,
    [tgKey],
  );
  let conv = rows[0];
  if (!conv) {
    const ins = await pool.query<ConvRow>(
      `INSERT INTO ai_assistant_conversations (telegram_user_id, telegram_chat_id, chat_type, display_name, platform_user_id)
       VALUES ($1,'web','web',$2,$3) RETURNING *`,
      [tgKey, platformUser?.fullName || "Xodim", opts.userId],
    );
    conv = ins.rows[0]!;
  }
  await saveMessage(conv.id, "user", opts.userText);

  // Admin web chatda yozsa — xodimni topib, amal darhol bajariladi
  if (platformUser?.role === "admin") {
    const texts = [opts.userText, ...opts.history.filter((h) => h.role === "user").map((h) => h.text).reverse()];
    const { user: target, candidates } = await resolveTargetFromTexts(texts).catch(() => ({
      user: null,
      candidates: [] as PlatformUser[],
    }));
    if (!target && candidates.length > 1) {
      const reply =
        "Bir nechta xodim topildi, qaysi biri?\n" +
        candidates.map((c, i) => `${i + 1}. ${c.fullName} — ${c.role}, login: ${c.login}`).join("\n") +
        "\nTo‘liq ism yoki loginini yozing.";
      await saveMessage(conv.id, "assistant", reply);
      return { reply, intent: "admin", proposal: null };
    }
    const effective = target ?? platformUser;
    const snapshot =
      `REJIM: ADMIN BUYRUG‘I (nishon — ${effective.fullName}).\n` +
      (await buildUserSnapshot(effective).catch(() => ""));
    const turn = aiAssistantEnabled()
      ? await callAi({
          snapshot,
          history: opts.history,
          userText: opts.userText,
          displayName: platformUser.fullName,
          adminMode: true,
        })
      : null;
    const result = turn ?? {
      reply: target
        ? `${target.fullName} bo‘yicha ma’lumot tayyor. Qaysi amal kerakligini aniq yozing.`
        : "Tushunmadim — kim haqida va nima qilish kerakligini aniqroq yozing (ism-familiya + amal).",
      intent: "admin",
      proposal: null as AiTurnResult["proposal"],
    };
    let reply = result.reply;
    let fileData: AiTurnResult["fileData"] = null;
    if (result.proposal) {
      const rec = await recordProposal(conv, effective.id, result.proposal, "executed", platformUser.id);
      if (rec.executionResult) reply = `${reply}\n\n✅ Bajarildi: ${rec.executionResult}`;
      else if (rec.error) reply = `${reply}\n\n⚠️ Bajarilmadi: ${rec.error}. Ma’lumotni aniqlashtirib qayta yozing.`;
    }
    // Admin fayl so'ragan bo'lsa (PDF/Excel) — tayyorlab beramiz, web chatda yuklab olinadi
    if (result.file) {
      try {
        const { buildAssistantFile } = await import("./ai-assistant-files");
        const built = await buildAssistantFile(
          result.file,
          target ? { userId: target.id, userName: target.fullName } : undefined,
        );
        fileData = { name: built.filename, mime: built.mime, base64: built.buffer.toString("base64") };
        reply = `${reply}\n\n📎 Fayl tayyor: ${built.filename} (${built.rowCount} qator) — yuklab olish avtomatik boshlanadi.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "noma'lum xato";
        logger.warn({ err }, "ai-assistant web admin file failed");
        reply = `${reply}\n\n⚠️ Fayl tayyorlanmadi: ${msg}. Qaysi ma’lumot kerakligini aniqroq yozing.`;
      }
    }
    await saveMessage(conv.id, "assistant", reply);
    await pool.query(`UPDATE ai_assistant_conversations SET intent=$2, updated_at=NOW() WHERE id=$1`, [conv.id, result.intent]);
    return { ...result, reply, fileData };
  }

  // Xodim: AI umuman ishlatilmaydi — faqat bazadan tayyor standart javob
  const result = await employeeStandardReply(platformUser, opts.userText, platformUser?.fullName || "Xodim");
  await saveMessage(conv.id, "assistant", result.reply);
  await pool.query(`UPDATE ai_assistant_conversations SET intent=$2, updated_at=NOW() WHERE id=$1`, [conv.id, result.intent]);
  // Xodim rejimi: taklif/amal yaratilmaydi — yozish va bajarish faqat adminda.
  return { ...result, proposal: null, file: null, fileData: null };
}

/** Admin qaroridan keyin xodimga xabar (tasdiq/rad) */
export async function sendAssistantFollowUp(conversationId: number, text: string): Promise<void> {
  await ensureAiAssistantSchema();
  const { rows } = await pool.query<ConvRow>(`SELECT * FROM ai_assistant_conversations WHERE id = $1`, [conversationId]);
  const conv = rows[0];
  if (!conv) return;
  await saveMessage(conversationId, "assistant", text);
  await sendMessage(
    conv.telegram_chat_id,
    text,
    conv.business_connection_id ? { business_connection_id: conv.business_connection_id } : undefined,
  ).catch((err) => logger.warn({ err }, "ai-assistant: follow-up send failed"));
}
