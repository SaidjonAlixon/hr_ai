import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import express from "express";
import { and, asc, eq, gt, isNotNull, ne, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import {
  db,
  usersTable,
  departmentsTable,
  telegramAuthTokensTable,
} from "@workspace/db";
import { setTelegramSessionCookie } from "../lib/session";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canManageSettings, canViewUlanganlar, NON_STAFF_ROLES } from "../lib/roles";
import { formatPersonName } from "../lib/person-name";
import { completeEnforcedDeviceLogin, shouldEnforceDeviceLogin } from "../lib/device-login";
import { clientIp, writeLoginAudit } from "../lib/device-security";
import {
  answerCallbackQuery,
  getMe,
  getWebhookInfo,
  isTelegramConfigured,
  newAuthToken,
  parseLoginPassword,
  publicAppUrl,
  ROLE_LABEL_UZ,
  sendDocument,
  sendMessage,
  setMiniAppMenuButton,
  setMyCommands,
  setWebhook,
  statusLabelUz,
  verifyTelegramInitData,
  verifyWebhookSecret,
  type InlineKeyboardButton,
  type TelegramUpdate,
} from "../lib/telegram";
import {
  handleGroupSupportMessage,
  handlePrivateSupportMessage,
  isGroupChat,
  messageHasImage,
} from "../lib/telegram-support";
import { handleAiAssistantMessage, handleAiGroupGate, registerBusinessConnection } from "../lib/ai-assistant";
import { isReportChat, observeGroupMessage } from "../lib/telegram-report-group";
import { isOfisStaffEmp } from "../lib/ofis-weekend";
import { logger } from "../lib/logger";
import { rateLimitAllow } from "../lib/rate-limit";

const router: IRouter = Router();
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function canSignIn(status?: string | null) {
  return status === "active" || status === "on_leave";
}

function statusBlockMessage(status?: string | null) {
  if (status === "on_leave") return "Foydalanuvchi tatilda (kirish mumkin, lekin cheklangan)";
  if (status === "terminated") return "Foydalanuvchi tugatilgan";
  if (status === "vacant" || status === "inactive" || status === "blocked") {
    return "Foydalanuvchi hozir bo‘sh / nofaol holatda";
  }
  return "Foydalanuvchi faol emas";
}

let telegramSchemaReady: Promise<void> | null = null;

async function ensureTelegramSchema() {
  if (!telegramSchemaReady) {
    telegramSchemaReady = (async () => {
      await db.execute(sql`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id text
      `);
      await db.execute(sql`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_linked_at timestamptz
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS telegram_auth_tokens (
          id serial PRIMARY KEY,
          token text NOT NULL UNIQUE,
          user_id integer NOT NULL,
          telegram_user_id text NOT NULL,
          chat_id text NOT NULL,
          used boolean NOT NULL DEFAULT false,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS telegram_auth_tokens_user_idx ON telegram_auth_tokens (user_id)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS telegram_auth_tokens_tg_idx ON telegram_auth_tokens (telegram_user_id)
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS telegram_link_tokens (
          token text PRIMARY KEY,
          user_id integer NOT NULL,
          expires_at timestamptz NOT NULL,
          used_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_idx ON telegram_link_tokens (user_id)
      `);
      await db.execute(sql`
        ALTER TABLE telegram_link_tokens ADD COLUMN IF NOT EXISTS code text
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS telegram_link_tokens_code_idx ON telegram_link_tokens (code) WHERE used_at IS NULL
      `);
    })().catch((err) => {
      telegramSchemaReady = null;
      throw err;
    });
  }
  await telegramSchemaReady;
}

async function getUserWithDept(userId: number) {
  const [user] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
      departmentName: departmentsTable.name,
      login: usersTable.login,
      phone: usersTable.phone,
      status: usersTable.status,
      telegramId: usersTable.telegramId,
      deviceSecurityEnforced: usersTable.deviceSecurityEnforced,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .where(eq(usersTable.id, userId));
  return user ?? null;
}

async function findUserByTelegramId(telegramUserId: string) {
  try {
    const [row] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.telegramId, telegramUserId))
      .limit(1);
    return row ? getUserWithDept(row.id) : null;
  } catch (err) {
    console.error("findUserByTelegramId:", err);
    return null;
  }
}

async function linkTelegram(userId: number, telegramUserId: string) {
  await db
    .update(usersTable)
    .set({ telegramId: null })
    .where(and(eq(usersTable.telegramId, telegramUserId), ne(usersTable.id, userId)));
  await db
    .update(usersTable)
    .set({ telegramId: telegramUserId })
    .where(eq(usersTable.id, userId));
  await ensureTelegramSchema();
  await db.execute(sql`UPDATE users SET telegram_linked_at = now() WHERE id = ${userId}`);
}

async function unlinkTelegram(telegramUserId: string) {
  await db
    .update(usersTable)
    .set({ telegramId: null })
    .where(eq(usersTable.telegramId, telegramUserId));
}

type UlanganCategory = "ofis" | "dorixona" | "boshqa";

const PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);

function ulanganCategory(role: string, orgRole: string | null, position: string | null): UlanganCategory {
  if (PHARMACY_USER_ROLES.has(role) || orgRole === "manager" || orgRole === "pharmacist" || orgRole === "intern") {
    return "dorixona";
  }
  if (isOfisStaffEmp({ userRole: role, orgRole, position })) return "ofis";
  return "boshqa";
}

type UlanganRow = {
  id: number;
  fullName: string;
  login: string;
  role: string;
  roleLabel: string;
  phone: string | null;
  status: string;
  department: string | null;
  position: string | null;
  branch: string | null;
  category: UlanganCategory;
  linked: boolean;
  telegramId: string | null;
  linkedAt: string | null;
};

async function loadUlanganlar(): Promise<UlanganRow[]> {
  await ensureTelegramSchema();
  const result = await db.execute(sql`
    SELECT u.id, u.full_name, u.login, u.role, u.phone, u.status, u.telegram_id, u.telegram_linked_at,
           d.name AS department, e.position, e.org_role,
           COALESCE(NULLIF(TRIM(b.location), ''), NULLIF(TRIM(e.location), '')) AS branch
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN LATERAL (
        SELECT position, org_role, location, assigned_branch_id
          FROM employees WHERE user_id = u.id ORDER BY id LIMIT 1
      ) e ON true
      LEFT JOIN employees b ON b.id = e.assigned_branch_id
     WHERE u.status IN ('active', 'on_leave')
       AND u.role NOT IN (${sql.join(NON_STAFF_ROLES.map((r) => sql`${r}`), sql`, `)})
     ORDER BY u.full_name
  `);
  const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => {
    const role = String(r.role ?? "");
    const telegramId = String(r.telegram_id ?? "").trim() || null;
    const linkedAt = r.telegram_linked_at ? new Date(String(r.telegram_linked_at)).toISOString() : null;
    return {
      id: Number(r.id),
      fullName: formatPersonName(String(r.full_name ?? "")),
      login: String(r.login ?? ""),
      role,
      roleLabel: ROLE_LABEL_UZ[role] || role,
      phone: (r.phone as string | null) ?? null,
      status: String(r.status ?? ""),
      department: (r.department as string | null) ?? null,
      position: (r.position as string | null) ?? null,
      branch: (r.branch as string | null) ?? null,
      category: ulanganCategory(role, (r.org_role as string | null) ?? null, (r.position as string | null) ?? null),
      linked: Boolean(telegramId),
      telegramId,
      linkedAt: telegramId ? linkedAt : null,
    };
  });
}

async function createMiniToken(opts: {
  userId: number;
  telegramUserId: string;
  chatId: string;
}) {
  const token = newAuthToken();
  // Mini App qayta ochilishi uchun — 7 kun amal qiladi (bir marta ishlatilsa ham qayta ochish mumkin)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(telegramAuthTokensTable).values({
    token,
    userId: opts.userId,
    telegramUserId: opts.telegramUserId,
    chatId: opts.chatId,
    used: false,
    expiresAt,
  });
  return token;
}

function miniAppEntryUrl(opts?: { next?: string; token?: string }): string | null {
  const base = publicAppUrl();
  if (!base) return null;
  const u = new URL(`${base}/tg`);
  if (opts?.next) u.searchParams.set("next", opts.next);
  if (opts?.token) u.searchParams.set("token", opts.token);
  // Har safar yangi akkauntga o‘tish — eski sessiya cache bo‘lmasin
  u.searchParams.set("fresh", "1");
  return u.toString();
}

function formatUserCard(user: {
  fullName: string;
  login: string;
  role: string;
  status: string;
  phone: string | null;
  departmentName: string | null;
}): string {
  const role = ROLE_LABEL_UZ[user.role] || user.role;
  const lines = [
    `✅ <b>Kirish tasdiqlandi</b>`,
    ``,
    `👤 <b>${escapeHtml(user.fullName)}</b>`,
    `🔑 Login: <code>${escapeHtml(user.login)}</code>`,
    `🏷 Lavozim: <b>${escapeHtml(role)}</b>`,
    `📌 Holat: <b>${escapeHtml(statusLabelUz(user.status))}</b>`,
  ];
  if (user.departmentName) {
    lines.push(`🏢 Bo‘lim: ${escapeHtml(user.departmentName)}`);
  }
  if (user.phone) {
    lines.push(`📞 Telefon: ${escapeHtml(user.phone)}`);
  }
  if (canManageSettings(user.role)) {
    lines.push(
      ``,
      `📊 Admin: <b>/hisobot</b> — Telegram bot foydalanuvchilari Excel`,
    );
  }
  lines.push(
    ``,
    `Pastdagi <b>Platformaga kirish</b> — istalgan vaqt oching (login/parol bir marta yetarli).`,
    `<b>Davomat</b> — Face ID + to‘liq holat.`,
    `Chiqish uchun <b>Chiqish</b> tugmasini bosing.`,
  );
  return lines.join("\n");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function welcomeText(name?: string): string {
  const greet = name ? `, ${escapeHtml(name)}` : "";
  return [
    `👋 <b>Xush kelibsiz${greet}!</b>`,
    ``,
    `VAKSINA MED HR Telegram botiga hush kelibsiz.`,
    ``,
    `🔗 <b>Eng oson yo‘l:</b> platformada <b>Botga ulanish</b> tugmasini bosing va chiqqan <b>6 xonali kodni</b> shu yerga yuboring.`,
    ``,
    `Yoki <b>login</b> va <b>parol</b>ni yuboring.`,
    ``,
    `<b>Namuna (1 qator):</b>`,
    `<code>farmasevt1 pass123</code>`,
    ``,
    `<b>Yoki 2 qator:</b>`,
    `<code>farmasevt1`,
    `pass123</code>`,
    ``,
    `<b>Yoki:</b>`,
    `<code>login: farmasevt1`,
    `parol: pass123</code>`,
    ``,
    `Faol akkaunt bo‘lsa — ma’lumotlaringiz chiqadi va <b>Kirish</b> orqali Mini App ochiladi.`,
  ].join("\n");
}

function helpText(isAdmin = false): string {
  const lines = [
    `<b>Buyruqlar</b>`,
    `/start — boshidan boshlash`,
    `/holat yoki /kirish — yangi «Platformaga kirish» havolasi`,
    `/davomat — Face ID davomat (Mini App)`,
    `/chiqish — Telegram bog‘lanishni uzish`,
    `/yordam — yordam`,
  ];
  if (isAdmin) {
    lines.splice(5, 0, `/hisobot — Telegram bot foydalanuvchilari (Excel)`);
  }
  lines.push(``, `Login/parolni yuqoridagi namuna tartibda yuboring.`);
  return lines.join("\n");
}

async function buildTelegramUsersExcel(): Promise<{
  buffer: Buffer;
  count: number;
  filename: string;
}> {
  const rows = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      login: usersTable.login,
      role: usersTable.role,
      phone: usersTable.phone,
      status: usersTable.status,
      telegramId: usersTable.telegramId,
      departmentName: departmentsTable.name,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .where(isNotNull(usersTable.telegramId))
    .orderBy(asc(usersTable.fullName));

  const linked = rows.filter((r) => String(r.telegramId || "").trim().length > 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = "VAKSINA MED HR Bot";
  wb.created = new Date();
  const sheet = wb.addWorksheet("Telegram foydalanuvchilar", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  sheet.mergeCells("A1:I1");
  const title = sheet.getCell("A1");
  title.value = `VAKSINA MED — Telegram bot foydalanuvchilari · Jami: ${linked.length}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 30;

  const headers = [
    "№",
    "F.I.Sh.",
    "Login",
    "Rol",
    "Bo‘lim",
    "Telefon",
    "Holat",
    "Telegram ID",
    "Ro‘yxatdan o‘tgan",
  ];
  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A5F8A" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  headerRow.height = 24;

  sheet.columns = [
    { width: 5 },
    { width: 28 },
    { width: 18 },
    { width: 20 },
    { width: 22 },
    { width: 16 },
    { width: 12 },
    { width: 18 },
    { width: 18 },
  ];

  linked.forEach((u, idx) => {
    const zebra = idx % 2 === 0 ? "FFF7FAFC" : "FFFFFFFF";
    const values = [
      idx + 1,
      formatPersonName(u.fullName) || u.fullName || "—",
      u.login || "—",
      ROLE_LABEL_UZ[u.role] || u.role || "—",
      u.departmentName || "—",
      u.phone || "—",
      statusLabelUz(u.status),
      String(u.telegramId || ""),
      u.createdAt
        ? new Date(u.createdAt).toLocaleString("uz-UZ", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
    ];
    const row = sheet.addRow(values);
    row.eachCell((cell, col) => {
      cell.font = { name: "Calibri", size: 11, bold: col === 2 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      cell.alignment = {
        vertical: "middle",
        horizontal: col === 1 || col === 7 ? "center" : "left",
      };
      if (col === 6 || col === 8) cell.numFmt = "@";
    });
    row.height = 20;
  });

  const footer = sheet.addRow([]);
  sheet.mergeCells(`A${footer.number}:I${footer.number}`);
  const fcell = sheet.getCell(`A${footer.number}`);
  fcell.value = `Jami ulangan: ${linked.length} ta · ${new Date().toLocaleString("uz-UZ")} · Faqat telegram_id bog‘langan foydalanuvchilar`;
  fcell.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF64748B" } };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    count: linked.length,
    filename: `telegram-foydalanuvchilar_${stamp}.xlsx`,
  };
}

async function handleHisobot(chatId: number | string, linked: NonNullable<Awaited<ReturnType<typeof getUserWithDept>>>) {
  if (!canManageSettings(linked.role)) {
    await sendMessage(
      chatId,
      "⛔ <b>/hisobot</b> faqat <b>Admin</b> yoki <b>Direktor</b> uchun.\nSizning rolingiz: " +
        escapeHtml(ROLE_LABEL_UZ[linked.role] || linked.role),
    );
    return;
  }

  await sendMessage(chatId, "⏳ Telegram foydalanuvchilar hisoboti tayyorlanmoqda…");
  try {
    const { buffer, count, filename } = await buildTelegramUsersExcel();
    await sendDocument(chatId, buffer, filename, {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      caption: `📊 Telegram bot foydalanuvchilari\nJami ulangan: ${count} ta`,
    });
  } catch (err) {
    console.error("telegram /hisobot:", err);
    await sendMessage(
      chatId,
      `❌ Hisobot yuborilmadi: ${escapeHtml((err as Error)?.message || "xato")}`,
    );
  }
}

async function sendLoggedInCard(
  chatId: number | string,
  user: NonNullable<Awaited<ReturnType<typeof getUserWithDept>>>,
  telegramUserId: string,
) {
  const tokenOpts = {
    userId: user.id,
    telegramUserId,
    chatId: String(chatId),
  };
  const loginToken = await createMiniToken(tokenOpts);
  const davomatToken = await createMiniToken(tokenOpts);
  const loginUrl = miniAppEntryUrl({ token: loginToken });
  const davomatUrl = miniAppEntryUrl({ next: "davomat-face", token: davomatToken });

  const rows: InlineKeyboardButton[][] = [];
  if (loginUrl) {
    rows.push([{ text: "🚀 Platformaga kirish", web_app: { url: loginUrl } }]);
  }
  if (davomatUrl) {
    rows.push([{ text: "📋 Davomat — Face ID", web_app: { url: davomatUrl } }]);
  }
  if (canManageSettings(user.role)) {
    rows.push([{ text: "📊 Hisobot — Telegram Excel", callback_data: "hisobot" }]);
  }
  rows.push([{ text: "🔄 Yangi kirish havolasi", callback_data: "refresh_entry" }]);
  rows.push([{ text: "🚪 Chiqish", callback_data: "logout" }]);

  const markup = { inline_keyboard: rows };

  let text = formatUserCard(user);
  if (!loginUrl && !davomatUrl) {
    text +=
      "\n\n⚠️ <b>PUBLIC_APP_URL</b> sozlanmagan — Mini App havolasi yaratilmadi. Admin Vercel env ga qo‘shishi kerak.";
  }
  await sendMessage(chatId, text, { reply_markup: markup });
}

async function sendDavomatMiniApp(
  chatId: number | string,
  user: NonNullable<Awaited<ReturnType<typeof getUserWithDept>>>,
  telegramUserId: string,
) {
  const token = await createMiniToken({
    userId: user.id,
    telegramUserId,
    chatId: String(chatId),
  });
  const davomatUrl = miniAppEntryUrl({ next: "davomat-face", token });
  if (!davomatUrl) {
    await sendMessage(chatId, "⚠️ PUBLIC_APP_URL sozlanmagan — Davomat Mini App ochilmaydi.");
    return;
  }
  await sendMessage(chatId, `📋 <b>Davomat — Face ID</b>\n\n${escapeHtml(user.fullName)}, tugmani bosing:`, {
    reply_markup: {
      inline_keyboard: [[{ text: "📋 Davomat — Face ID", web_app: { url: davomatUrl } }]],
    },
  });
}

const LINK_TOKEN_TTL_MS = 30 * 60_000;
const LINK_PAYLOAD_PREFIX = "link_";

const LINK_CODE_RE = /^\d{6}$/;

/**
 * Platformadagi «Botga ulanish»: t.me/<bot>?start=link_<token> yoki 6 xonali kod.
 * Kod — chat oldindan ochiq bo‘lsa Telegram start payload ni yubormasligi uchun zaxira.
 */
async function handleLinkStart(
  chatId: number,
  fromId: number,
  key: { token: string } | { code: string },
): Promise<boolean> {
  if ("token" in key && !/^[a-f0-9]{32}$/.test(key.token)) return false;
  if ("code" in key) {
    if (!LINK_CODE_RE.test(key.code)) return false;
    if (!rateLimitAllow(`tg-link-code:${fromId}`, 8, 10 * 60_000)) {
      await sendMessage(chatId, "⏳ Juda ko‘p urinish. 10 daqiqadan keyin qayta yuboring.");
      return true;
    }
  }
  await ensureTelegramSchema();
  const claimed =
    "token" in key
      ? await db.execute(sql`
          UPDATE telegram_link_tokens SET used_at = now()
           WHERE token = ${key.token} AND used_at IS NULL AND expires_at > now()
           RETURNING user_id
        `)
      : await db.execute(sql`
          UPDATE telegram_link_tokens SET used_at = now()
           WHERE code = ${key.code} AND used_at IS NULL AND expires_at > now()
           RETURNING user_id
        `);
  const rows = (
    Array.isArray(claimed) ? claimed : ((claimed as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ user_id?: number }>;
  const userId = Number(rows[0]?.user_id);
  logger.info(
    { event: "telegram_link", via: "token" in key ? "deeplink" : "code", ok: userId > 0, fromId },
    "telegram link attempt",
  );
  if (!Number.isFinite(userId) || userId <= 0) {
    await sendMessage(
      chatId,
      "code" in key
        ? "❌ Kod noto‘g‘ri yoki eskirgan.\nPlatformada <b>Botga ulanish</b> tugmasini qayta bosing va yangi kodni yuboring."
        : "⌛ Ulash havolasi eskirgan yoki ishlatilgan.\nPlatformada <b>Botga ulanish</b> tugmasini qayta bosing.",
      { parse_mode: "HTML" },
    );
    return true;
  }
  const user = await getUserWithDept(userId);
  if (!user || !canSignIn(user.status)) {
    await sendMessage(chatId, `⛔ ${statusBlockMessage(user?.status)}`);
    return true;
  }
  await linkTelegram(user.id, String(fromId));
  await sendMessage(
    chatId,
    [
      `🎉 <b>Akkaunt botga ulandi!</b>`,
      ``,
      `👤 ${escapeHtml(user.fullName)}`,
      ``,
      `Endi topshiriqlar, davomat, eslatmalar va barcha muhim holatlar shu yerga keladi.`,
    ].join("\n"),
    { parse_mode: "HTML" },
  );
  await sendLoggedInCard(chatId, { ...user, telegramId: String(fromId) }, String(fromId));
  return true;
}

let cachedBotUsername: string | null = null;
async function botUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await getMe();
    if (me?.username) cachedBotUsername = me.username;
  } catch {
    /* fallback */
  }
  return cachedBotUsername || "vaksinahrbot";
}

async function handleStart(chatId: number, fromId: number, firstName?: string, payload = "") {
  logger.info({ event: "telegram_start", fromId, payload: payload ? payload.slice(0, 5) : null }, "telegram /start");
  if (payload.startsWith(LINK_PAYLOAD_PREFIX)) {
    if (await handleLinkStart(chatId, fromId, { token: payload.slice(LINK_PAYLOAD_PREFIX.length) })) return;
  }
  if (LINK_CODE_RE.test(payload)) {
    if (await handleLinkStart(chatId, fromId, { code: payload })) return;
  }
  const linked = await findUserByTelegramId(String(fromId));
  if (linked && canSignIn(linked.status)) {
    await sendMessage(
      chatId,
      `👋 Yana xush kelibsiz!\nSiz allaqachon tizimga bog‘langansiz.`,
    );
    await sendLoggedInCard(chatId, linked, String(fromId));
    return;
  }
  await sendMessage(chatId, welcomeText(firstName));
}

async function handleCredentials(
  chatId: number,
  fromId: number,
  loginRaw: string,
  passwordRaw: string,
) {
  const compact = (v: string) => String(v ?? "").replace(/[\s\u00a0\u200b\uFEFF]+/g, "");
  const login = compact(loginRaw);
  const password = compact(passwordRaw);
  const [user] = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.login}) = lower(${login})`)
    .limit(1);

  if (!user || compact(String(user.password ?? "")) !== password) {
    await sendMessage(
      chatId,
      `❌ Login yoki parol noto‘g‘ri.\n\nNamuna:\n<code>farmasevt1 pass123</code>`,
    );
    return;
  }

  if (!canSignIn(user.status)) {
    await sendMessage(
      chatId,
      `⛔ ${statusBlockMessage(user.status)}\nHolat: <b>${statusLabelUz(user.status)}</b>`,
    );
    return;
  }

  await linkTelegram(user.id, String(fromId));
  const full = await getUserWithDept(user.id);
  if (!full) {
    await sendMessage(chatId, "❌ Foydalanuvchi yuklanmadi");
    return;
  }
  await sendLoggedInCard(chatId, full, String(fromId));
}

/** AI javobi sekin bo‘lishi mumkin — VPS da fonda, serverless (Vercel) da kutib bajariladi */
async function runSupportTask(task: () => Promise<unknown>) {
  if (process.env.VERCEL) {
    await task().catch((err) => console.error("telegram support:", err));
    return;
  }
  void task().catch((err) => console.error("telegram support:", err));
}

async function handleUpdate(update: TelegramUpdate) {
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const fromId = cq.from.id;
    const data = cq.data || "";
    try {
      await answerCallbackQuery(cq.id);
    } catch {
      /* ignore */
    }
    if (!chatId) return;

    if (data === "logout") {
      await unlinkTelegram(String(fromId));
      await sendMessage(chatId, "🚪 Chiqildi. Qayta kirish uchun login va parol yuboring.\n/start");
      return;
    }
    if (data === "refresh_entry") {
      const linked = await findUserByTelegramId(String(fromId));
      if (!linked || !canSignIn(linked.status)) {
        await sendMessage(chatId, "Avval login va parol yuboring.\n/start");
        return;
      }
      await sendMessage(chatId, "🔄 Yangi kirish havolasi tayyor:");
      await sendLoggedInCard(chatId, linked, String(fromId));
      return;
    }
    if (data === "hisobot") {
      const linked = await findUserByTelegramId(String(fromId));
      if (!linked || !canSignIn(linked.status)) {
        await sendMessage(chatId, "Avval login va parol yuboring.\n/start");
        return;
      }
      await handleHisobot(chatId, linked);
      return;
    }
    return;
  }

  // Telegram Business: akkauntga bot ulandi — egasini qayd qilamiz (faqat adminniki ishlaydi)
  if (update.business_connection) {
    await registerBusinessConnection(update.business_connection).catch((err) =>
      console.error("business_connection register:", err),
    );
    return;
  }

  const msg = update.message ?? update.business_message;
  if (!msg?.from || msg.from.is_bot) return;
  const businessConnectionId = msg.business_connection_id;

  if (isGroupChat(msg.chat)) {
    await observeGroupMessage(msg);
    if (await isReportChat(msg.chat)) return;
    // Yordamchi AI guruh darvozasi: adminga javob yo‘q, /bot_on|/bot_off faqat adminda, o‘chirilgan guruhda jim
    const gated = await handleAiGroupGate(msg).catch((err) => {
      console.error("ai-group-gate:", err);
      return false;
    });
    if (gated) return;
    const gText = (msg.text ?? msg.caption ?? "").toLowerCase();
    const directToBot =
      gText.includes("@vaksinahrbot") || msg.reply_to_message?.from?.username === "vaksinahrbot";
    if (directToBot) {
      await runSupportTask(() => handleAiAssistantMessage(msg, { businessConnectionId }));
      return;
    }
    await runSupportTask(() => handleGroupSupportMessage(msg));
    return;
  }

  // Ovoz / video xabar — AI yordamchi yozib yuborishni so‘raydi
  if (msg.voice || msg.video_note || msg.audio) {
    await runSupportTask(() => handleAiAssistantMessage(msg, { businessConnectionId }));
    return;
  }

  if (!msg.text) {
    if (messageHasImage(msg)) {
      await runSupportTask(async () => {
        const handled = await handlePrivateSupportMessage(msg);
        if (!handled) {
          await sendMessage(
            msg.chat.id,
            "Muammoni qisqa matn bilan yozing (masalan: «kirmadi», «smena», «javob olish», «Face ID», «joylashuv») yoki /yordam.",
            businessConnectionId ? { business_connection_id: businessConnectionId } : undefined,
          );
        }
      });
    }
    return;
  }

  const chatId = msg.chat.id;
  const fromId = msg.from.id;
  const text = msg.text.trim();

  if (text === "/start" || text.startsWith("/start ")) {
    await handleStart(chatId, fromId, msg.from.first_name, text.slice(6).trim());
    return;
  }
  if (text === "/yordam" || text === "/help") {
    const linked = await findUserByTelegramId(String(fromId));
    await sendMessage(chatId, helpText(canManageSettings(linked?.role)));
    return;
  }
  if (text === "/holat" || text === "/kirish") {
    const linked = await findUserByTelegramId(String(fromId));
    if (!linked) {
      await sendMessage(chatId, "Hali akkaunt bog‘lanmagan.\nLogin va parol yuboring yoki /start.");
      return;
    }
    await sendLoggedInCard(chatId, linked, String(fromId));
    return;
  }
  if (text === "/hisobot") {
    const linked = await findUserByTelegramId(String(fromId));
    if (!linked || !canSignIn(linked.status)) {
      await sendMessage(chatId, "Avval admin login/parol bilan botga kiring.\n/start");
      return;
    }
    await handleHisobot(chatId, linked);
    return;
  }
  if (text === "/davomat") {
    const linked = await findUserByTelegramId(String(fromId));
    if (!linked || !canSignIn(linked.status)) {
      await sendMessage(chatId, "Avval login va parol yuboring.\n/start");
      return;
    }
    await sendDavomatMiniApp(chatId, linked, String(fromId));
    return;
  }
  if (text === "/chiqish" || text === "/logout") {
    await unlinkTelegram(String(fromId));
    await sendMessage(chatId, "🚪 Chiqildi. Qayta kirish: /start");
    return;
  }

  const maybeCode = text.replace(/[\s-]/g, "");
  if (LINK_CODE_RE.test(maybeCode)) {
    if (await handleLinkStart(chatId, fromId, { code: maybeCode })) return;
  }

  const creds = parseLoginPassword(text);
  if (creds) {
    await handleCredentials(chatId, fromId, creds.login, creds.password);
    return;
  }

  // Yordamchi AI: bazani o‘qib suhbatlashadi, amal kerak bo‘lsa adminga taklif tayyorlaydi
  if (!text.startsWith("/")) {
    const handled = await handleAiAssistantMessage(msg, { businessConnectionId }).catch((err) => {
      console.error("ai-assistant:", err);
      return false;
    });
    if (handled) return;
    if (await handlePrivateSupportMessage(msg)) return;
  }

  await sendMessage(
    chatId,
    `Tushunmadim.\n\nLogin va parolni shu tartibda yuboring:\n<code>login parol</code>\n\nYordam: /yordam`,
    businessConnectionId ? { business_connection_id: businessConnectionId } : undefined,
  );
}

/** Telegram webhook — avval ishlov berish, keyin 200 (Vercel serverless freeze muammosi) */
router.post("/telegram/webhook", async (req, res): Promise<void> => {
  if (!isTelegramConfigured()) {
    res.status(503).json({ error: "TELEGRAM_BOT_TOKEN sozlanmagan" });
    return;
  }
  if (!verifyWebhookSecret(req.header("x-telegram-bot-api-secret-token") || undefined)) {
    res.status(401).json({ error: "Webhook secret noto‘g‘ri" });
    return;
  }

  const work = ensureTelegramSchema()
    .then(() => handleUpdate(req.body as TelegramUpdate))
    .catch((err) => console.error("telegram webhook handler:", err));
  // Telegram bitta botning yangilanishlarini navbat bilan yuboradi — sekin javob keyingi xabarlarni ushlab turadi.
  // Serverless’da javobdan keyin jarayon to‘xtatiladi, shuning uchun u yerda kutiladi.
  if (isServerless) await work;
  res.status(200).json({ ok: true });
});

/** Mini App: Telegram initData yoki (eski) token → session cookie */
async function finishTelegramLogin(
  req: import("express").Request,
  res: import("express").Response,
  user: NonNullable<Awaited<ReturnType<typeof getUserWithDept>>> & { telegramId?: string | null },
): Promise<void> {
  const { telegramId: _tg, ...safe } = user;
  const ua = "telegram-mini-app";
  const ip = clientIp(req);
  const enforced = await shouldEnforceDeviceLogin(user);

  if (!enforced) {
    await setTelegramSessionCookie(res, user.id, { ipAddress: ip, userAgent: ua });
    await writeLoginAudit({
      userId: user.id,
      ipAddress: ip,
      userAgent: ua,
      action: "login",
      status: "success",
      failureReason: null,
      meta: { mode: "telegram-legacy" },
    });
    res.json({ user: safe, ok: true, deviceSecurity: { enforced: false } });
    return;
  }

  const result = await completeEnforcedDeviceLogin({
    req,
    res,
    user,
    fullUser: safe,
    deviceBody: req.body?.device,
    siteMode: "telegram",
    userAgentOverride: ua,
  });
  if (result.kind === "ok") {
    res.json(result.payload);
    return;
  }
  res.status(result.status).json(result.payload);
}

router.post("/telegram/mini-auth", async (req, res): Promise<void> => {
  const initData = String(req.body?.initData || "").trim();
  const token = String(req.body?.token || "").trim();

  try {
    await ensureTelegramSchema();

    if (initData) {
      const parsed = verifyTelegramInitData(initData);
      if (!parsed) {
        res.status(401).json({ error: "Telegram tasdiqlanmadi. Botdan qayta oching." });
        return;
      }

      const linked = await findUserByTelegramId(String(parsed.user.id));
      if (!linked) {
        res.status(403).json({
          error: "Avval botda login va parol yuboring, keyin «Platformaga kirish» ni bosing.",
        });
        return;
      }
      if (!canSignIn(linked.status)) {
        res.status(403).json({ error: statusBlockMessage(linked.status) });
        return;
      }

      await finishTelegramLogin(req, res, linked);
      return;
    }

    if (!token) {
      res.status(400).json({ error: "Telegram initData kerak" });
      return;
    }

    // Muddat ichida — ishlatilgan token ham qayta ochishda ishlaydi (Mini App yopib qayta kirish)
    const [row] = await db
      .select()
      .from(telegramAuthTokensTable)
      .where(
        and(
          eq(telegramAuthTokensTable.token, token),
          gt(telegramAuthTokensTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(401).json({
        error: "Token muddati tugagan. Botdan «Platformaga kirish» yoki /start bosing.",
        code: "token_invalid",
      });
      return;
    }

    const user = await getUserWithDept(row.userId);
    if (!user || !canSignIn(user.status)) {
      res.status(403).json({ error: statusBlockMessage(user?.status) });
      return;
    }

    if (!row.used) {
      await db
        .update(telegramAuthTokensTable)
        .set({ used: true })
        .where(eq(telegramAuthTokensTable.id, row.id));
    }

    if (user.telegramId !== row.telegramUserId) {
      await linkTelegram(user.id, row.telegramUserId);
    }

    const full = await getUserWithDept(user.id);
    if (!full) {
      res.status(403).json({ error: statusBlockMessage(user.status) });
      return;
    }
    await finishTelegramLogin(req, res, full);
  } catch (err) {
    console.error("telegram mini-auth:", err);
    res.status(503).json({ error: "Kirish muvaffaqiyatsiz — qayta urinib ko‘ring" });
  }
});

/** Mini App: faylni foydalanuvchi Telegram chatiga yuborish */
router.post(
  "/telegram/send-file",
  requireAuth,
  express.raw({ type: () => true, limit: "15mb" }),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      if (!isTelegramConfigured()) {
        res.status(503).json({ error: "Telegram bot sozlanmagan" });
        return;
      }
      if (!req.userId) {
        res.status(401).json({ error: "Avtorizatsiya kerak" });
        return;
      }

      const [user] = await db
        .select({ id: usersTable.id, telegramId: usersTable.telegramId })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId))
        .limit(1);

      if (!user?.telegramId) {
        res.status(400).json({
          error: "Telegram bog‘lanmagan. Avval botda login/parol yuboring.",
          code: "telegram_not_linked",
        });
        return;
      }

      const buffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body ?? []);
      if (!buffer.length) {
        res.status(400).json({ error: "Fayl yuborilmadi" });
        return;
      }

      let fileName = "fayl";
      const rawName = req.headers["x-file-name"];
      if (typeof rawName === "string" && rawName.trim()) {
        try {
          fileName = decodeURIComponent(rawName).slice(0, 120);
        } catch {
          fileName = rawName.slice(0, 120);
        }
      }

      const mimeType =
        (typeof req.headers["content-type"] === "string" &&
          req.headers["content-type"] !== "application/octet-stream"
          ? req.headers["content-type"]
          : undefined) || undefined;

      await sendDocument(user.telegramId, buffer, fileName, {
        mimeType,
        caption: `📁 ${fileName}`,
      });

      res.json({ ok: true, sentTo: "telegram" });
    } catch (err) {
      console.error("telegram send-file:", err);
      res.status(503).json({
        error: (err as Error)?.message || "Telegramga yuborilmadi",
      });
    }
  },
);

/** Joriy akkaunt botga ulanganmi — ofis xodimlariga banner ko‘rsatish uchun */
router.get("/telegram/link-status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [u] = await db
      .select({ role: usersTable.role, telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);
    const linked = Boolean(u?.telegramId?.trim());
    const office = isOfisStaffEmp({ userRole: u?.role });
    res.json({
      linked,
      office,
      show: isTelegramConfigured() && office && !linked,
      botUsername: await botUsername(),
    });
  } catch (err) {
    console.error("GET /telegram/link-status:", err);
    res.status(503).json({ error: "Holat yuklanmadi" });
  }
});

/** Bir martalik ulash havolasi — bot /start link_<token> orqali akkauntni bog‘laydi */
router.post("/telegram/link-token", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    if (!isTelegramConfigured()) {
      res.status(503).json({ error: "Telegram bot sozlanmagan" });
      return;
    }
    await ensureTelegramSchema();
    const userId = req.userId!;
    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);
    await db.execute(sql`
      DELETE FROM telegram_link_tokens
       WHERE used_at IS NOT NULL OR expires_at < now() OR (user_id = ${userId} AND used_at IS NULL)
    `);
    let code = "";
    for (let i = 0; i < 8 && !code; i++) {
      const candidate = String(crypto.randomInt(100_000, 1_000_000));
      const taken = await db.execute(sql`
        SELECT 1 FROM telegram_link_tokens WHERE code = ${candidate} AND used_at IS NULL AND expires_at > now() LIMIT 1
      `);
      const takenRows = Array.isArray(taken) ? taken : ((taken as { rows?: unknown[] }).rows ?? []);
      if (!takenRows.length) code = candidate;
    }
    if (!code) throw new Error("Kod yaratilmadi");
    await db.execute(sql`
      INSERT INTO telegram_link_tokens (token, user_id, expires_at, code)
      VALUES (${token}, ${userId}, ${expiresAt}, ${code})
    `);
    const username = await botUsername();
    const payload = `${LINK_PAYLOAD_PREFIX}${token}`;
    res.json({
      url: `https://t.me/${username}?start=${payload}`,
      appUrl: `tg://resolve?domain=${username}&start=${payload}`,
      botUrl: `https://t.me/${username}`,
      botUsername: username,
      code,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("POST /telegram/link-token:", err);
    res.status(503).json({ error: "Havola yaratilmadi" });
  }
});

const CATEGORY_LABEL: Record<UlanganCategory, string> = { ofis: "Ofis", dorixona: "Dorixona", boshqa: "Boshqa" };

/** Ulanganlar — botga ulangan / ulanmagan xodimlar (admin, asoschi) */
router.get("/telegram/ulanganlar", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewUlanganlar(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const items = await loadUlanganlar();
    const bucket = () => ({ total: 0, linked: 0 });
    const byCategory = { ofis: bucket(), dorixona: bucket(), boshqa: bucket() };
    for (const it of items) {
      byCategory[it.category].total += 1;
      if (it.linked) byCategory[it.category].linked += 1;
    }
    const linked = items.filter((i) => i.linked).length;
    res.json({
      generatedAt: new Date().toISOString(),
      botUsername: await botUsername(),
      totals: { all: items.length, linked, unlinked: items.length - linked, byCategory },
      items,
    });
  } catch (err) {
    console.error("GET /telegram/ulanganlar:", err);
    res.status(503).json({ error: "Ro‘yxat yuklanmadi" });
  }
});

/** Ulanganlar — Excel (ikki varaq: Ulanganlar / Ulanmaganlar) */
router.get("/telegram/ulanganlar/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewUlanganlar(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const cat = String(req.query.category || "");
    const items = (await loadUlanganlar()).filter((i) => !cat || cat === "all" || i.category === cat);
    const wb = new ExcelJS.Workbook();
    const fmt = (iso: string | null) =>
      iso
        ? new Intl.DateTimeFormat("uz-UZ", {
            timeZone: "Asia/Tashkent",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(iso))
        : "";
    for (const [title, list] of [
      ["Ulanganlar", items.filter((i) => i.linked)],
      ["Ulanmaganlar", items.filter((i) => !i.linked)],
    ] as const) {
      const ws = wb.addWorksheet(title);
      ws.columns = [
        { header: "№", key: "n", width: 6 },
        { header: "F.I.Sh.", key: "name", width: 32 },
        { header: "Login", key: "login", width: 22 },
        { header: "Lavozim", key: "role", width: 22 },
        { header: "Turi", key: "cat", width: 12 },
        { header: "Bo‘lim", key: "dept", width: 24 },
        { header: "Filial", key: "branch", width: 28 },
        { header: "Telefon", key: "phone", width: 16 },
        { header: "Ulangan vaqti", key: "at", width: 18 },
      ];
      list.forEach((i, idx) =>
        ws.addRow({
          n: idx + 1,
          name: i.fullName,
          login: i.login,
          role: i.roleLabel,
          cat: CATEGORY_LABEL[i.category],
          dept: i.department || "",
          branch: i.branch || "",
          phone: i.phone || "",
          at: fmt(i.linkedAt),
        }),
      );
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: title === "Ulanganlar" ? "FF0F766E" : "FFB45309" } };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = { from: "A1", to: "I1" };
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Ulanganlar_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error("GET /telegram/ulanganlar.xlsx:", err);
    res.status(503).json({ error: "Excel tayyorlanmadi" });
  }
});

/** Holat: bot sozlanganmi */
router.get("/telegram/status", async (_req, res): Promise<void> => {
  const configured = isTelegramConfigured();
  const appUrl = publicAppUrl();
  let webhook: unknown = null;
  if (configured) {
    try {
      webhook = await getWebhookInfo();
    } catch (e) {
      webhook = { error: (e as Error).message };
    }
  }
  let bot: { username?: string; first_name?: string } | null = null;
  if (configured) {
    try {
      bot = await getMe();
    } catch {
      bot = null;
    }
  }
  res.json({
    configured,
    appUrl: appUrl || null,
    miniAppReady: !!(configured && appUrl),
    botUsername: bot?.username ? `@${bot.username}` : null,
    botName: bot?.first_name ?? null,
    webhook,
  });
});

/** Webhookni o‘rnatish — CRON_SECRET yoki TELEGRAM_SETUP_SECRET */
router.post("/telegram/setup", async (req, res): Promise<void> => {
  const secret =
    process.env.TELEGRAM_SETUP_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const auth = req.header("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const bodySecret = String(req.body?.secret || "");
  if (!secret || (bearer !== secret && bodySecret !== secret)) {
    res.status(401).json({ error: "Ruxsat yo‘q" });
    return;
  }
  if (!isTelegramConfigured()) {
    res.status(503).json({ error: "TELEGRAM_BOT_TOKEN sozlanmagan" });
    return;
  }

  const base = publicAppUrl();
  if (!base) {
    res.status(400).json({
      error: "PUBLIC_APP_URL (yoki VERCEL_URL) kerak — masalan https://hr-ai-gamma.vercel.app",
    });
    return;
  }

  try {
    await ensureTelegramSchema();
    const webhookUrl = `${base}/api/telegram/webhook`;
    const whSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    await setWebhook(webhookUrl, whSecret);
    await setMyCommands([
      { command: "start", description: "Boshlash / kirish" },
      { command: "holat", description: "Akkaunt va Mini App" },
      { command: "davomat", description: "Face ID davomat" },
      { command: "hisobot", description: "Admin: Telegram Excel hisobot" },
      { command: "chiqish", description: "Bog‘lanishni uzish" },
      { command: "yordam", description: "Yordam" },
    ]);
    await setMiniAppMenuButton("Tizimga kirish", `${base}/tg`);
    const info = await getWebhookInfo();
    res.json({ ok: true, webhookUrl, info });
  } catch (err) {
    console.error("telegram setup:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
