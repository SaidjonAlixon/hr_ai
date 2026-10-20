/**
 * Yordamchi AI — @vaksinahrbot orqali xodimlar bilan suhbat.
 *
 * Qoidalar:
 *  - Platforma bazasidan FAQAT o‘qiydi (davomat, atestatsiya, javob olish, profil).
 *  - Hech qanday o‘zgarishni o‘zi bajarmaydi: amal kerak bo‘lsa «taklif» tayyorlaydi,
 *    admin «Yordamchi AI» bo‘limida tasdiqlasa — shundagina bajariladi va xodimga javob ketadi.
 *  - Xodim qaysi tilda / yozuvda (lotin, kirill, rus) yozsa — javob ham o‘shanda.
 *  - Ovozli xabar: eshitolmasligini aytib, yozib yuborishni so‘raydi.
 *  - Parol so‘ramaydi; yuborilsa — ogohlantiradi.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
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
import { sendMessage, type TelegramMessage } from "./telegram";

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
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/* ------------------------------------------------------------------- types */

export type AiProposalKind = "davomat_fix" | "atestatsiya_retake" | "account_help" | "admin_task";

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

/** F.I.Sh. bo‘yicha qidirish (lotin/kirill farqi bo‘lsa ham tokenlar bo‘yicha) */
async function searchUsersByName(raw: string): Promise<PlatformUser[]> {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 3);
  if (!tokens.length) return [];
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
    .where(and(...tokens.map((t) => ilike(usersTable.fullName, `%${t}%`))))
    .limit(5);
  return rows;
}

async function extractMentionedUser(historyText: string, self: PlatformUser | null): Promise<PlatformUser | null> {
  if (self) return self;
  // Suhbatda ism-familiya yozilgan bo‘lishi mumkin — oxirgi xabarlardan qidiramiz
  const lines = historyText.split(/\n/).slice(-6);
  for (const line of lines.reverse()) {
    const found = await searchUsersByName(line).catch(() => []);
    if (found.length === 1) return found[0]!;
  }
  return null;
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
      parts.push(
        "Davomat (oxirgi): " +
          recs
            .map(
              (r) =>
                `${r.workDate}: keldim=${r.checkInAt ? new Date(r.checkInAt).toISOString() : "—"}, ketdim=${r.checkOutAt ? new Date(r.checkOutAt).toISOString() : "—"}, holat=${r.status}${r.excused ? " (sababli)" : ""}`,
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
    "BAZANI O‘ZGARTIRMA: sen hech qanday o‘zgarish qila olmaysiz. Amal kerak bo‘lsa (davomat tuzatish, testni qayta ochish va h.k.) taklif tayyorla — admin tasdiqlasa bajariladi. Xodimga: muammoni o‘rganib chiqdim, tayyorlab qo‘yaman, admin tasdiqlashi bilan hal bo‘ladi, tez orada javob yozaman — deb umid ber.",
    "Noqonuniy/for qalbakilashtirish so‘ralsa (masalan kelmagan kunga davomat yozib berish): rad et, sababini odamdek tushuntir va qonuniy yo‘lni ayt (javob olish so‘rovi, koordinatordan tasdiq). Bunday so‘rov uchun taklif YARATMA.",
    "Ma’lumot yetishmasa bitta-ikkita aniq savol ber: ism-familiya, filial, sana/vaqt, qanday xato chiqyapti. Hamma ma’lumot yig‘ilgach va xodim aniq amal so‘ragach — proposal yarat.",
    "Savol faqat ma’lumot so‘rasa (test qayerdan, qanday ishlanadi, smena, kirish...): bazadagi faktlar + jonli holat asosida to‘liq javob ber, proposal kerak emas.",
    "Javob uzunligi: odatda 2–6 jumla, ro‘yxat kerak bo‘lsa qisqa ro‘yxat. Ortiqcha rasmiyatchilik qilma.",
    "",
    'Faqat JSON qaytar: {"reply":"...","intent":"davomat|atestatsiya|login|javob|smena|savol|boshqa","proposal":null yoki {"kind":"davomat_fix|atestatsiya_retake|account_help|admin_task","title":"qisqa sarlavha","summary":"adminga: kim, nima, sabab, tekshirilgan faktlar","payload":{"userId":123,"workDate":"2026-10-20","examId":1,"note":"..."},"completionText":"admin tasdiqlasa xodimga yuboriladigan yakuniy xabar (xodim tilida)"}}',
    "davomat_fix payload da iloji bo‘lsa workDate va tuzatiladigan vaqtlarni yoz. atestatsiya_retake da examId ni yoz (bilinmasa summary da test nomini yoz).",
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
      const kinds: AiProposalKind[] = ["davomat_fix", "atestatsiya_retake", "account_help", "admin_task"];
      const kind = kinds.includes(p.kind as AiProposalKind) ? (p.kind as AiProposalKind) : "admin_task";
      proposal = {
        kind,
        title: String(p.title).slice(0, 200),
        summary: String(p.summary).slice(0, 4000),
        payload: (p.payload && typeof p.payload === "object" ? p.payload : {}) as Record<string, unknown>,
        completionText: p.completionText ? String(p.completionText).slice(0, 1000) : undefined,
      };
    }
    return { reply: reply.slice(0, 3000), intent: String(parsed.intent || "boshqa").slice(0, 40), proposal };
  } catch (err) {
    logger.warn({ err }, "ai-assistant: openai failed");
    return null;
  }
}

function fallbackTurn(userText: string, snapshot: string | null, displayName: string): AiTurnResult {
  const cyrl = detectScript(userText) === "cyrl";
  const reply = snapshot
    ? cyrl
      ? `Тушундим, ${displayName}. Муаммонгизни кўриб чиқяпман — маълумотларни текширдим. Аниқроқ бўлиши учун сана/вақт ва қандай хато чиқаётганини ёзсангиз, тайёрлаб қўяман — админ тасдиқлаши билан ҳал бўлади.`
      : `Tushundim, ${displayName}. Muammoingizni ko‘rib chiqyapman — ma’lumotlarni tekshirdim. Aniqroq bo‘lishi uchun sana/vaqt va qanday xato chiqayotganini yozsangiz, tayyorlab qo‘yaman — admin tasdiqlashi bilan hal bo‘ladi.`
    : cyrl
      ? `Салом, ${displayName}! Ёрдам бераман. Аввал исм-фамилиянгиз ва филиалингизни ёзинг, кейин муаммони қисқа ёзинг — текшириб, тайёрлаб қўяман.`
      : `Salom, ${displayName}! Yordam beraman. Avval ism-familiyangiz va filialingizni yozing, keyin muammoni qisqa yozing — tekshirib, tayyorlab qo‘yaman.`;
  return { reply, intent: "boshqa", proposal: null };
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
  const self = conv.platform_user_id
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
    : await findUserByTelegram(String(msg.from.id)).catch(() => null);

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

  const snapshot = platformUser ? await buildUserSnapshot(platformUser).catch(() => null) : null;

  const turn = aiAssistantEnabled()
    ? await callAi({ snapshot, history, userText: text, displayName: senderDisplayName(msg) })
    : null;
  const result = turn ?? fallbackTurn(text, snapshot, senderDisplayName(msg));

  await saveMessage(conv.id, "assistant", result.reply);
  await pool.query(`UPDATE ai_assistant_conversations SET intent = $2, updated_at = NOW() WHERE id = $1`, [
    conv.id,
    result.intent,
  ]);

  if (result.proposal) {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO ai_assistant_proposals (conversation_id, platform_user_id, kind, title, summary, payload)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        conv.id,
        platformUser?.id ?? null,
        result.proposal.kind,
        result.proposal.title,
        result.proposal.summary,
        JSON.stringify({ ...result.proposal.payload, completionText: result.proposal.completionText || null }),
      ],
    );
    await pool.query(`UPDATE ai_assistant_conversations SET status = 'waiting_admin', updated_at = NOW() WHERE id = $1`, [
      conv.id,
    ]);
    const pid = ins.rows[0]!.id;
    void notifyAdminsAboutProposal(pid, conv, result.proposal);
  }

  await sendMessage(chatId, result.reply, sendOpts).catch((err) => {
    logger.warn({ err }, "ai-assistant: sendMessage failed");
  });
  return true;
}

/**
 * Platforma ichidagi chat (login qilgan xodim): Telegram oqimi bilan bir xil —
 * jonli baza snapshot, suhbat tarixi, kerak bo‘lsa adminga taklif.
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
  const snapshot = platformUser ? await buildUserSnapshot(platformUser).catch(() => null) : null;
  const turn = aiAssistantEnabled()
    ? await callAi({
        snapshot,
        history: opts.history,
        userText: opts.userText,
        displayName: platformUser?.fullName || "Xodim",
      })
    : null;
  const result = turn ?? fallbackTurn(opts.userText, snapshot, platformUser?.fullName || "Xodim");
  await saveMessage(conv.id, "assistant", result.reply);
  await pool.query(`UPDATE ai_assistant_conversations SET intent=$2, updated_at=NOW() WHERE id=$1`, [conv.id, result.intent]);
  if (result.proposal) {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO ai_assistant_proposals (conversation_id, platform_user_id, kind, title, summary, payload)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        conv.id,
        opts.userId,
        result.proposal.kind,
        result.proposal.title,
        result.proposal.summary,
        JSON.stringify({ ...result.proposal.payload, completionText: result.proposal.completionText || null, source: "web" }),
      ],
    );
    await pool.query(`UPDATE ai_assistant_conversations SET status='waiting_admin', updated_at=NOW() WHERE id=$1`, [conv.id]);
    void notifyAdminsAboutProposal(ins.rows[0]!.id, conv, result.proposal);
  }
  return result;
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
